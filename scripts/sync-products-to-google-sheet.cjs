/**
 * Sync products from Mongo into the LINX Living Google Sheet.
 *
 * Reads from Mongo (the source of truth) rather than hooking the app, so it
 * catches every write path: the admin UI, Shopify webhooks, and the ~112 bulk
 * import scripts that write to the collection directly.
 *
 * Products already in the sheet are matched on the "Product ID" column, so
 * re-running is safe — it never double-appends.
 *
 * Setup (one-off):
 *   1. Create a Google Cloud service account, enable the Google Sheets API,
 *      and download its JSON key.
 *   2. Share the sheet with the service account's client_email as **Editor**.
 *   3. Add to .env.local:
 *        GOOGLE_SHEET_ID=1k8zyvooR7VFWaQptu4JFd2ry93mvL6FJ6myOj3gc_i4
 *        GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./google-service-account.json
 *      (or GOOGLE_SERVICE_ACCOUNT_JSON='<the raw JSON>')
 *
 * Usage:
 *   node scripts/sync-products-to-google-sheet.cjs            # append new only
 *   node scripts/sync-products-to-google-sheet.cjs --full     # rewrite all rows
 *   node scripts/sync-products-to-google-sheet.cjs --dry-run  # report, write nothing
 *   node scripts/sync-products-to-google-sheet.cjs --watch    # stay running, live sync
 */
const path = require("path");
const fs = require("fs");
const { connectMongo } = require("./mongo-connect.cjs");
const {
  COLUMNS,
  loadLookups,
  buildRow,
  rowToArray,
  compareRows,
} = require("./lib/product-rows.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const DRY = argv.includes("--dry-run");
const WATCH = argv.includes("--watch");

/** --brand="Natura Flooring" — sync one brand only, for a small first run. */
const BRAND = (() => {
  const a = argv.find((x) => x.startsWith("--brand="));
  if (a) return a.slice("--brand=".length).trim();
  const i = argv.indexOf("--brand");
  return i >= 0 && argv[i + 1] ? argv[i + 1].trim() : "";
})();

// --full clears every row before rewriting, so scoping it to one brand would
// wipe the other brands off the sheet. Refuse rather than destroy data.
if (FULL && BRAND) {
  console.error(
    "--full rewrites the whole sheet and would delete every other brand's rows.\n" +
      "Use --brand on its own (append mode), or --full on its own.",
  );
  process.exit(1);
}

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  "1k8zyvooR7VFWaQptu4JFd2ry93mvL6FJ6myOj3gc_i4";
const TAB = process.env.GOOGLE_SHEET_TAB || "All Products";
/** Sheets rejects payloads over ~10MB; append in chunks. */
const CHUNK = Number(process.env.SYNC_CHUNK) || 2000;

function log(...a) {
  console.log(`[sync ${new Date().toISOString().slice(11, 19)}]`, ...a);
}

/** Build an authorised Sheets client from the service account key. */
async function getSheets() {
  const { google } = require("googleapis");

  let creds;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else {
    const keyFile =
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      path.join(__dirname, "..", "google-service-account.json");
    if (!fs.existsSync(keyFile)) {
      throw new Error(
        `No Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or place the ` +
          `service-account key at ${keyFile}, then share the sheet with its ` +
          `client_email as Editor.`,
      );
    }
    creds = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return {
    api: google.sheets({ version: "v4", auth: await auth.getClient() }),
    email: creds.client_email,
  };
}

/** Create the tab if missing; make sure row 1 is our header. */
async function ensureSheet(api) {
  const meta = await api.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = meta.data.sheets.find((s) => s.properties.title === TAB);

  if (!existing) {
    log(`tab "${TAB}" not found — creating it`);
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: TAB,
                gridProperties: { frozenRowCount: 1, columnCount: COLUMNS.length },
              },
            },
          },
        ],
      },
    });
  }

  const head = await api.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!1:1`,
  });
  const current = head.data.values?.[0] || [];
  const matches =
    current.length === COLUMNS.length &&
    COLUMNS.every((c, i) => current[i] === c);

  if (!matches) {
    log("writing header row");
    await api.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [COLUMNS] },
    });
  }
}

/** Product IDs already present in the sheet (column A, below the header). */
async function existingIds(api) {
  const res = await api.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2:A`,
  });
  return new Set((res.data.values || []).map((r) => String(r[0] || "")).filter(Boolean));
}

async function appendRows(api, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await api.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: slice.map(rowToArray) },
    });
    log(`appended ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
}

/** One sync pass. Returns the number of rows written. */
async function syncOnce(db, api) {
  const lookups = await loadLookups(db);
  const products = await db.collection("products").find({}).toArray();
  let all = products.map((p) => buildRow(p, lookups)).sort(compareRows);

  if (BRAND) {
    const want = BRAND.toLowerCase();
    const matched = all.filter((r) => r.Brand.toLowerCase() === want);
    if (!matched.length) {
      const names = [...new Set(all.map((r) => r.Brand))].sort();
      throw new Error(
        `No brand called "${BRAND}". Available:\n  ${names.join("\n  ")}`,
      );
    }
    log(`brand filter: "${matched[0].Brand}" — ${matched.length} product(s)`);
    all = matched;
  }

  if (FULL) {
    log(`full rewrite: ${all.length} products`);
    if (DRY) return all.length;
    await api.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A2:ZZ`,
    });
    await appendRows(api, all);
    return all.length;
  }

  const have = await existingIds(api);
  const fresh = all.filter((r) => !have.has(r["Product ID"]));

  if (!fresh.length) {
    log(`up to date — ${have.size} rows in sheet, nothing new`);
    return 0;
  }

  const byBrand = {};
  for (const r of fresh) byBrand[r.Brand] = (byBrand[r.Brand] || 0) + 1;
  log(`${fresh.length} new product(s):`, JSON.stringify(byBrand));

  if (DRY) {
    log("dry run — not writing");
    return fresh.length;
  }
  await appendRows(api, fresh);
  return fresh.length;
}

(async () => {
  const { api, email } = await getSheets();
  log(`authenticated as ${email}`);
  log(`sheet ${SHEET_ID} → tab "${TAB}"`);

  const conn = await connectMongo();
  const db = conn.db;

  await ensureSheet(api);
  const n = await syncOnce(db, api);
  log(`done — ${n} row(s) written`);

  if (!WATCH) {
    await conn.close();
    process.exit(0);
  }

  // Live mode: Mongo change stream fires on every insert, whatever wrote it.
  log("watching for new products… (ctrl-C to stop)");
  const stream = db.collection("products").watch([
    { $match: { operationType: "insert" } },
  ]);

  let pending = false;
  stream.on("change", () => {
    if (pending) return;
    pending = true;
    // Coalesce bursts — bulk imports insert thousands at a time.
    setTimeout(async () => {
      pending = false;
      try {
        await syncOnce(db, api);
      } catch (e) {
        console.error("[sync] pass failed:", e.message);
      }
    }, Number(process.env.SYNC_DEBOUNCE_MS) || 10000);
  });

  stream.on("error", (e) => {
    console.error("[sync] change stream error:", e.message);
    process.exit(1);
  });
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
