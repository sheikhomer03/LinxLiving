/**
 * Give merged variants their supplier SKUs back.
 *
 * merge-variants-brands.cjs fell back to `${baseItem.sku || "MERGED"}-V${n}`
 * when a member had no `sku`, and most had their code in `supplierSku` or
 * `productCode` instead — so hundreds of products carry "MERGED-V1",
 * "MERGED-V2"… and Shopify sees the same SKU on every one of them. Each
 * variant still knows its original product (`originalId`, or its own `_id`),
 * and the 2026-09-24 backup holds that product's real code.
 *
 *   node scripts/fix-merged-variant-skus.cjs           # dry run
 *   node scripts/fix-merged-variant-skus.cjs --apply   # write (backs up first)
 */
require("dotenv").config({ path: ".env.local" });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { MongoClient, BSON } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = path.join(__dirname, "../backups/db-2026-09-24-exact");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const PLACEHOLDER = /(^|-)V\d+$/i;

async function loadBackup() {
  const byId = new Map();
  for (const label of ["secondary", "primary"]) {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(BACKUP_DIR, label, "test", "products.ejson.gz")).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const doc = BSON.EJSON.parse(line, { relaxed: true });
      const id = String(doc._id);
      if (!byId.has(id)) byId.set(id, doc);
    }
  }
  return byId;
}

const codeOf = (o) =>
  String(o?.sku || o?.supplierSku || o?.productCode || o?.linxSku || o?.specs?.sku || "").trim();

async function main() {
  const backup = await loadBackup();
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const col = client.db("test").collection("products");
  const docs = await col.find({ "variants.sku": { $regex: PLACEHOLDER.source, $options: "i" } }).toArray();

  const undo = [];
  let rows = 0;
  let products = 0;
  const unresolved = [];
  for (const doc of docs) {
    const used = new Set(doc.variants.map((v) => String(v.sku || "").toLowerCase()));
    let changed = false;
    const variants = doc.variants.map((v) => {
      const current = String(v.sku || "");
      if (!PLACEHOLDER.test(current) || !/merged|-v\d+$/i.test(current)) return v;
      const orig = backup.get(String(v.originalId || "")) || backup.get(String(v._id || ""));
      const code = codeOf(orig);
      if (!code || PLACEHOLDER.test(code) || used.has(code.toLowerCase())) {
        // Not in the backup: at least make the code unique to this product,
        // so Shopify and the order history can tell it from every other
        // "MERGED-V2" in the catalogue.
        const n = (current.match(/V(\d+)$/i) || [])[1] || "1";
        const unique = `LX-${String(doc._id).slice(-8).toUpperCase()}-V${n}`;
        unresolved.push({ id: String(doc._id), name: doc.name, variant: v.name, sku: `${current} → ${unique}` });
        used.add(unique.toLowerCase());
        rows++;
        changed = true;
        return { ...v, sku: unique };
      }
      used.add(code.toLowerCase());
      rows++;
      changed = true;
      return { ...v, sku: code };
    });
    if (!changed) continue;
    products++;
    if (APPLY) {
      undo.push(BSON.EJSON.stringify({ cluster: "secondary", doc }, { relaxed: false }));
      await col.updateOne({ _id: doc._id }, { $set: { variants } });
    }
  }
  if (APPLY && undo.length) {
    const file = path.join(__dirname, `../backups/pre-sku-fix-${STAMP}.ejson`);
    fs.writeFileSync(file, undo.join("\n") + "\n");
    console.log(`Previous versions saved to ${file}`);
  }
  console.log({ productsWithPlaceholders: docs.length, productsFixed: products, variantsFixed: rows, unresolved: unresolved.length });
  if (unresolved.length) console.log(unresolved.slice(0, 15));
  if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply to save.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
