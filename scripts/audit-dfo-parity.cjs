/**
 * Recheck every Direct Flooring Online product against the live PDP.
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-dfo-parity.cjs
 *   SAMPLE=0  — 0 = all
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://directflooringonline.co.uk";
const STORE_API = `${BASE}/wp-json/wc/store/v1/products`;
const SAMPLE = Number(process.env.SAMPLE ?? 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const REPORT = path.join(__dirname, "_tmp-dfo-parity-report.json");
const UA = "Mozilla/5.0 LinxDfoAudit/1.0";

const decode = (s) =>
  String(s || "")
    .replace(/&#8217;|&#039;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&nbsp;/g, " ")
    .trim();

const slugFromUrl = (u) => (String(u || "").match(/\/product\/([^/?#]+)/) || [])[1] || "";
const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;

async function mapPool(items, n, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length || 1) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    }),
  );
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "direct-flooring-online" });
  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({
      name: 1,
      price: 1,
      images: 1,
      description: 1,
      attributes: 1,
      addonGroups: 1,
      specs: 1,
    })
    .toArray();
  if (SAMPLE > 0) products = products.slice(0, SAMPLE);
  await mongoose.disconnect();
  console.log(`Auditing ${products.length} products…`);

  const rows = [];
  let ok = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (p) => {
    const slug = p.specs?.dfoSlug || slugFromUrl(p.specs?.sourceUrl);
    if (!slug) {
      rows.push({ name: p.name, gaps: ["no slug"] });
      fail++;
      return;
    }
    try {
      const res = await fetch(`${STORE_API}?slug=${encodeURIComponent(slug)}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      const api = (await res.json())[0];
      if (!api) throw new Error("not in Store API");

      const gaps = [];
      const livePrice = Number(api.prices?.price || 0) / 100;
      if (livePrice > 0 && !near(p.price, livePrice)) {
        gaps.push(`price ${p.price}!=${livePrice}`);
      }
      const liveImgs = (api.images || []).length;
      if (liveImgs > (p.images || []).length) {
        gaps.push(`images ${(p.images || []).length}<${liveImgs}`);
      }
      const liveAttrs = (api.attributes || []).filter(
        (a) => a.name && (a.terms || []).length,
      ).length;
      if (liveAttrs > (p.attributes || []).length) {
        gaps.push(`attributes ${(p.attributes || []).length}<${liveAttrs}`);
      }
      const liveName = decode(api.name);
      if (liveName && liveName !== String(p.name).trim()) gaps.push("name");
      const liveDesc = String(api.description || "").replace(/<[^>]+>/g, " ").trim();
      const mineDesc = String(p.description || "").replace(/<[^>]+>/g, " ").trim();
      if (liveDesc.length > 40 && mineDesc.length < liveDesc.length * 0.5) {
        gaps.push("description thin");
      }
      if (Number(p.specs?.parityVersion || 0) < 1) gaps.push("parityVersion");

      if (gaps.length) {
        rows.push({ slug, name: p.name, gaps, mine: p.price, live: livePrice });
      } else {
        ok++;
      }
    } catch (e) {
      fail++;
      rows.push({ slug, name: p.name, gaps: [`error: ${e.message}`] });
    }
  });

  const gapRows = rows.filter((r) => r.gaps?.length);
  console.log(
    `\nAudit complete. checked=${products.length} ok=${ok} needsFix=${gapRows.length - fail} fail=${fail}`,
  );
  for (const r of gapRows.slice(0, 20)) {
    console.log(`  ${String(r.name).slice(0, 46).padEnd(46)} ${r.gaps.join(", ")}`);
  }
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ at: new Date().toISOString(), checked: products.length, ok, rows: gapRows }, null, 2),
  );
  console.log(`report: ${REPORT}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
