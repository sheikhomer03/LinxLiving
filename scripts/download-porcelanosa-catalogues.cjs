/**
 * Mirror Porcelanosa's customer-facing literature into public/porcelanosa.
 *
 * The scrape stores Porcelanosa's own URLs, so every one of these links on our
 * PDPs is a hotlink to their server: if they move or retire a file it breaks
 * silently on our side. The catalogue links alone — 2,502 of them — resolve to
 * only 17 distinct PDFs, so hosting them ourselves is cheap insurance.
 *
 * Covers the two literature types their document taxonomy actually has:
 * Catalogues and Dossiers. Technical documents (data sheets, DoPs, CAD, BIM)
 * are deliberately left hotlinked — they are generated per SAP code, run to
 * thousands of distinct files, and go stale in a way a catalogue does not.
 *
 * productfinder.porcelanosagrupo.com answers 403 to plain HTTP clients — the
 * files only serve to something that looks like a browser — so the download
 * runs through Playwright's request context rather than fetch().
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/download-porcelanosa-catalogues.cjs
 *   DRY=1  list what would be fetched, download nothing
 *   FORCE=1  re-download files already on disk
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { chromium } = require("playwright");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const BRAND_SLUG = "porcelanosagrupo";
const PUBLIC = path.join(__dirname, "..", "public", "porcelanosa");

/**
 * Literature types to mirror, matched on the title the scrape stored. Each
 * gets its own folder so the public tree stays readable.
 */
const TYPES = [
  { label: "catalogue", match: /catalogue/i, dir: "catalogues" },
  { label: "dossier", match: /dossier|brochure/i, dir: "dossiers" },
];
/** Their CDN gates on a real session, so load the finder before the files. */
const HOME = "https://productfinder.porcelanosagrupo.com/en/product_finder.html";
const MANIFEST = path.join(__dirname, "porcelanosa-catalogue-manifest.json");

/** A 403 page is HTML and still writes 200-ish bytes — only trust real PDFs. */
function isPdf(buf) {
  return buf.length > 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand "${BRAND_SLUG}" not found`);

  const all = await db
    .collection("products")
    .aggregate([
      { $match: { brand: brand._id } },
      { $unwind: "$filesDocumentation" },
      { $unwind: "$filesDocumentation.files" },
      {
        $group: {
          _id: "$filesDocumentation.files.url",
          title: { $first: "$filesDocumentation.files.title" },
          products: { $sum: 1 },
        },
      },
      { $sort: { products: -1 } },
    ])
    .toArray();

  // Tag each URL with the literature type it belongs to; drop the rest.
  const rows = [];
  for (const r of all) {
    const type = TYPES.find((t) => t.match.test(String(r.title || "")));
    if (type) rows.push({ ...r, type });
  }

  for (const t of TYPES) {
    const mine = rows.filter((r) => r.type === t);
    console.log(
      `${mine.length} distinct ${t.label}(s) behind ` +
        `${mine.reduce((s, r) => s + r.products, 0)} product links`,
    );
    fs.mkdirSync(path.join(PUBLIC, t.dir), { recursive: true });
  }
  console.log("");
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};

  if (DRY) {
    for (const r of rows) console.log(`  would fetch  ${r._id}`);
    await mongoose.disconnect();
    return;
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // Warm the session. The page itself may be blocked; the cookies still land.
  await ctx.newPage().then((p) =>
    p.goto(HOME, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {}),
  );

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const url = r._id;
    const base = path.basename(new URL(url).pathname);
    const dest = path.join(PUBLIC, r.type.dir, base);
    const publicPath = `/porcelanosa/${r.type.dir}/${base}`;

    if (!FORCE && fs.existsSync(dest) && isPdf(fs.readFileSync(dest))) {
      manifest[url] = publicPath;
      skipped++;
      console.log(`  SKIP  ${base}  (already on disk)`);
      continue;
    }

    // Their origin rate-limits: a burst of requests comes back as a 39KB HTML
    // 500, and the largest catalogues need well over two minutes. Both clear
    // on a retry with a pause, so treat neither as terminal on first sight.
    let buf = null;
    let note = "";
    for (let attempt = 1; attempt <= 4 && !buf; attempt++) {
      try {
        const res = await ctx.request.get(url, { timeout: 300000 });
        const body = Buffer.from(await res.body());
        if (res.status() === 200 && isPdf(body)) {
          buf = body;
          break;
        }
        note = `http=${res.status()} ${body.length}B`;
      } catch (e) {
        note = String(e.message).split("\n")[0].slice(0, 50);
      }
      if (attempt < 4) {
        console.log(`  retry ${attempt}/3  ${base}  (${note})`);
        await new Promise((r) => setTimeout(r, attempt * 8000));
      }
    }
    if (!buf) {
      failed++;
      console.log(`  FAIL  ${base}  ${note}`);
      continue;
    }
    fs.writeFileSync(dest, buf);
    manifest[url] = publicPath;
    saved++;
    console.log(
      `  SAVE  [${r.type.label}] ${base}  ${Math.round(buf.length / 1024)}KB  ` +
        `(${r.products} products)`,
    );
  }

  await browser.close();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `\nSaved ${saved}, skipped ${skipped}, failed ${failed} → public/porcelanosa`,
  );
  console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
  if (failed) process.exitCode = 1;

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
