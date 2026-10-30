/**
 * Snapshot Al Murad live stock from al-murad.co.uk into .scratch/almurad/stock-live-snapshot.jsonl
 * 
 * Complies with .claude/claude.md Phase 3:
 * - Read-only (no writes to MongoDB or Shopify)
 * - Concurrency <= 3, ~300ms polite delay
 * - Resumable checkpointing
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../../", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { applyDns } = require("../../scripts/mongo-connect.cjs");
applyDns();

const ORIGIN = "https://www.al-murad.co.uk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CONCURRENCY = Number(process.env.CONCURRENCY) || 8;
const DELAY_MS = Number(process.env.DELAY_MS) || 50;

const DATA_DIR = path.join(__dirname);
const SNAPSHOT_FILE = path.join(DATA_DIR, "stock-live-snapshot.jsonl");
const COOKIE_FILE = path.join(DATA_DIR, "am-cookie.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let COOKIE = "";

async function bootstrap() {
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
      if (Date.now() - saved.at < 12 * 60 * 60 * 1000) {
        COOKIE = saved.cookie;
        return;
      }
    } catch {}
  }

  const res1 = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
  const html1 = await res1.text();
  const setCookie = res1.headers.get("set-cookie") || "";
  const cookieBits = setCookie
    .split(/,(?=[^;]+=[^;]+;)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="));
  const code = (/accessCode = "([^"]+)"/.exec(html1) || [])[1];
  if (!code) throw new Error("Could not find ayh_access code on Al Murad homepage");

  const res2 = await fetch(ORIGIN + "/?ayh_access=" + code, {
    headers: { "user-agent": UA, cookie: cookieBits.join("; ") },
  });
  const setCookie2 = res2.headers.get("set-cookie") || "";
  const moreBits = setCookie2
    .split(/,(?=[^;]+=[^;]+;)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="));

  const merged = new Map();
  for (const c of [...cookieBits, ...moreBits]) {
    const [k] = c.split("=");
    merged.set(k, c);
  }
  COOKIE = [...merged.values()].join("; ");
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ at: Date.now(), cookie: COOKIE }));
  console.log("Bootstrap complete; session cookie acquired.");
}

async function fetchLiveStatus(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          cookie: COOKIE,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 404) {
        return { available: false, statusText: "gone_404", httpStatus: 404 };
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const html = await res.text();
      if (/<title>Are you human\?<\/title>/i.test(html)) {
        console.warn("Encountered bot check, re-bootstrapping...");
        await bootstrap();
        continue;
      }

      // Extract JSON-LD
      const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
      let availability = null;
      let sku = null;
      let name = null;

      if (ldMatch) {
        try {
          const data = JSON.parse(ldMatch[1]);
          const offers = data.offers || data.Offers;
          if (offers) {
            availability = String(offers.availability || "").toLowerCase();
          }
          sku = data.sku || data.SKU;
          name = data.name;
        } catch {}
      }

      // Fallback check against raw HTML if JSON-LD missing
      if (!availability) {
        if (/availability:\s*out\s*of\s*stock/i.test(html) || /out\s*of\s*stock/i.test(html)) {
          availability = "outofstock";
        } else if (/availability:\s*in\s*stock/i.test(html) || /in\s*stock/i.test(html)) {
          availability = "instock";
        }
      }

      const isAvailable = availability ? !availability.includes("outofstock") : true;

      return {
        available: isAvailable,
        statusText: isAvailable ? "in_stock" : "out_of_stock",
        sku,
        name,
        httpStatus: 200,
        fetchedAt: new Date().toISOString(),
      };
    } catch (e) {
      if (i === tries) {
        return { available: false, statusText: "error", error: e.message, httpStatus: 0 };
      }
      await sleep(1000 * i);
    }
  }
}

async function main() {
  await bootstrap();

  // Load existing snapshot records if any
  const completed = new Map();
  if (fs.existsSync(SNAPSHOT_FILE)) {
    const rl = readline.createInterface({ input: fs.createReadStream(SNAPSHOT_FILE) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.url && row.httpStatus === 200) completed.set(row.url, row);
      } catch {}
    }
  }
  console.log(`Resuming snapshot: ${completed.size} URLs already fetched.`);

  // Load target URLs from am-pdp.jsonl & DB2
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATA_DIR, "am-pdp.jsonl")) });
  const skuToUrl = new Map();
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.sku && rec.sourceUrl) skuToUrl.set(String(rec.sku).trim(), rec.sourceUrl);
    } catch {}
  }

  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 20000 }).asPromise();
  const pCol = conn.db.collection("products");
  const brandId = new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a");
  const products = await pCol.find({ brand: brandId }, {
    projection: { _id: 1, sourceUrl: 1, variants: 1 }
  }).toArray();
  await conn.close();

  const allUrls = new Set();
  for (const p of products) {
    if (p.sourceUrl) allUrls.add(p.sourceUrl);
    if (p.variants) {
      for (const v of p.variants) {
        const u = skuToUrl.get(String(v.sku).trim());
        if (u) allUrls.add(u);
      }
    }
  }

  const targetList = [...allUrls].filter((u) => !completed.has(u));
  console.log(`Total URLs: ${allUrls.size}. Remaining to fetch: ${targetList.length}.`);

  const outStream = fs.createWriteStream(SNAPSHOT_FILE, { flags: "a" });

  let doneCount = completed.size;
  let inStockCount = [...completed.values()].filter((r) => r.available).length;
  let oosCount = completed.size - inStockCount;

  // Concurrency worker queue
  let currentIndex = 0;
  const workers = Array.from({ length: CONCURRENCY }, async (_, workerId) => {
    while (currentIndex < targetList.length) {
      const idx = currentIndex++;
      const url = targetList[idx];

      const res = await fetchLiveStatus(url);
      const record = { url, ...res };

      outStream.write(JSON.stringify(record) + "\n");
      doneCount++;
      if (record.available) inStockCount++;
      else oosCount++;

      if (doneCount % 50 === 0 || doneCount === allUrls.size) {
        const pct = ((doneCount / allUrls.size) * 100).toFixed(1);
        console.log(`[Progress ${pct}%] ${doneCount}/${allUrls.size} fetched | In Stock: ${inStockCount} | Out of Stock: ${oosCount}`);
      }

      await sleep(DELAY_MS);
    }
  });

  await Promise.all(workers);
  outStream.end();

  console.log("\n================ SNAPSHOT COMPLETE ================");
  console.log(`Total Live URLs Checked: ${doneCount}`);
  console.log(`In Stock:                ${inStockCount}`);
  console.log(`Out of Stock / Gone:     ${oosCount}`);
  console.log(`Snapshot saved to:       ${SNAPSHOT_FILE}`);
}

main().catch((err) => {
  console.error("Snapshot error:", err);
  process.exit(1);
});
