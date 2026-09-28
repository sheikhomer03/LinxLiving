/**
 * Move the "Better Bathrooms" brand record from the primary cluster (DB1) to
 * DB2, keeping its _id so every product's brand reference stays valid.
 * Touches only the brand with slug "better-bathrooms".
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const { MongoClient } = require("mongodb");

(async () => {
  const c1 = new MongoClient(process.env.MONGODB_URI), c2 = new MongoClient(process.env.MONGODB_URL2);
  await Promise.all([c1.connect(), c2.connect()]);
  const b1 = c1.db().collection("brands"), b2 = c2.db().collection("brands");
  const brand = await b1.findOne({ slug: "better-bathrooms" });
  const already = await b2.findOne({ slug: "better-bathrooms" });
  if (!brand && already) { console.log("already in DB2 only:", String(already._id)); process.exit(0); }
  if (!brand) throw new Error("brand not found in DB1");
  if (!already) await b2.insertOne({ ...brand, updatedAt: new Date() });
  const copy = await b2.findOne({ _id: brand._id });
  if (!copy) throw new Error("copy to DB2 not confirmed — DB1 record left in place");
  await b1.deleteOne({ _id: brand._id, slug: "better-bathrooms" });
  const linked = await c2.db().collection("products").countDocuments({ "specs.source": "bb-scrape", brand: brand._id });
  console.log({ movedBrandId: String(brand._id), inDB2: true, inDB1: !!(await b1.findOne({ _id: brand._id })), productsLinked: linked });
  await Promise.all([c1.close(), c2.close()]);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
