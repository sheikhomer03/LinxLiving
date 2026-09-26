/**
 * Archive the Shopify products left behind by the colour/size merges.
 *
 * merge-variants-brands.cjs deleted each merged member from Mongo but left its
 * Shopify product live, so the store listed every member twice: once inside
 * the merged product and once on its own. Archiving (not deleting) takes them
 * off the storefront and sales channels while keeping their order history;
 * any of them can be set back to Active from Shopify admin.
 *
 * A product is archived only if the 2026-09-24 backup shows it belonged to a
 * member that no longer exists, and no product in either cluster still points
 * at its Shopify id.
 *
 *   node scripts/archive-premerge-shopify-products.cjs           # dry run
 *   node scripts/archive-premerge-shopify-products.cjs --apply
 */
require("tsx/cjs");
require("dotenv").config({ path: ".env.local" });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { MongoClient, BSON } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const APPLY = process.argv.includes("--apply");
const BACKUPS = path.join(__dirname, "../backups");
const RESTORE_REPORT = path.join(BACKUPS, "merged-image-restore-report-2026-09-26T10-00-23-274Z.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(BACKUPS, `archived-premerge-shopify-products-${STAMP}.json`);

async function loadBackup() {
  const byId = new Map();
  for (const label of ["secondary", "primary"]) {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(BACKUPS, "db-2026-09-24-exact", label, "test", "products.ejson.gz")).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const m = line.match(/^\{"_id":\{"\$oid":"([0-9a-f]{24})"/);
      if (!m || byId.has(m[1])) continue;
      const gid = (line.match(/"shopifyProductId":"(gid:\/\/shopify\/Product\/\d+)"/) || [])[1];
      const name = (line.match(/"name":"((?:[^"\\]|\\.)*)"/) || [])[1];
      byId.set(m[1], { gid, name });
    }
  }
  return byId;
}

async function main() {
  const backup = await loadBackup();
  const primary = new MongoClient(process.env.MONGODB_URI);
  const secondary = new MongoClient(process.env.MONGODB_URL2);
  await primary.connect();
  await secondary.connect();

  // Every Shopify product id still in use by any current product.
  const inUse = new Set();
  const existing = new Set();
  for (const c of [primary, secondary]) {
    const rows = await c.db("test").collection("products").find({}, { projection: { shopifyProductId: 1 } }).toArray();
    for (const r of rows) {
      existing.add(String(r._id));
      if (r.shopifyProductId) inUse.add(r.shopifyProductId);
    }
  }

  const mergedIds = JSON.parse(fs.readFileSync(RESTORE_REPORT, "utf8")).products.filter((p) => !p.skipped).map((p) => p.id);
  const merged = await secondary
    .db("test")
    .collection("products")
    .find({ _id: { $in: mergedIds.map((i) => new BSON.ObjectId(i)) } }, { projection: { name: 1, variants: 1 } })
    .toArray();

  const targets = new Map();
  let keptInUse = 0;
  for (const doc of merged) {
    for (const v of doc.variants || []) {
      const origId = String(v.originalId || v._id || "");
      if (!origId || origId === String(doc._id) || existing.has(origId)) continue;
      const orig = backup.get(origId);
      if (!orig?.gid) continue;
      if (inUse.has(orig.gid)) {
        keptInUse++;
        continue;
      }
      targets.set(orig.gid, { gid: orig.gid, original: orig.name, mergedInto: String(doc._id), mergedName: doc.name });
    }
  }

  // Confirm each is live and not already archived.
  const list = [...targets.values()];
  const live = [];
  for (let i = 0; i < list.length; i += 100) {
    const data = await shopifyAdminRequest(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id status title } } }`, {
      ids: list.slice(i, i + 100).map((t) => t.gid),
    });
    for (const n of data.nodes) if (n && n.status !== "ARCHIVED") live.push({ ...targets.get(n.id), title: n.title, statusBefore: n.status });
  }
  console.log({ candidates: list.length, stillLinkedSkipped: keptInUse, toArchive: live.length });

  let done = 0;
  const failed = [];
  if (APPLY) {
    for (const t of live) {
      try {
        const data = await shopifyAdminRequest(
          `mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id status } userErrors { message } } }`,
          { p: { id: t.gid, status: "ARCHIVED" } },
        );
        const errs = data.productUpdate.userErrors || [];
        if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
        t.archivedAt = new Date().toISOString();
        done++;
        if (done % 100 === 0) console.log(`   … ${done}/${live.length}`);
      } catch (e) {
        t.error = e.message;
        failed.push(t);
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ mode: APPLY ? "apply" : "dry-run", archived: done, failed: failed.length, products: live }, null, 2));
  console.log(APPLY ? `Archived ${done}, failed ${failed.length}.` : "Dry run — nothing archived.", `List: ${OUT}`);
  await primary.close();
  await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
