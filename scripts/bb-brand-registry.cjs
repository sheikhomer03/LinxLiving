/**
 * Register the Better Bathrooms brand where the storefront looks for brands.
 *
 * The site resolves every brand from DB1's `brands` (name, visibility and
 * which cluster holds its products). The brand's own record and all its
 * products stay in DB2; this adds the same brand — same _id — to DB1 with
 * dataCluster "secondary", so the site finds it and routes to DB2. No other
 * record is read or changed.
 *
 *   node scripts/bb-brand-registry.cjs            # register, hidden
 *   node scripts/bb-brand-registry.cjs --visible  # show on storefront
 *   node scripts/bb-brand-registry.cjs --hidden   # hide again
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const { MongoClient } = require("mongodb");

const SLUG = "better-bathrooms";
const visible = process.argv.includes("--visible") ? true : process.argv.includes("--hidden") ? false : null;

(async () => {
  const c1 = new MongoClient(process.env.MONGODB_URI), c2 = new MongoClient(process.env.MONGODB_URL2);
  await Promise.all([c1.connect(), c2.connect()]);
  const db1 = c1.db().collection("brands"), db2 = c2.db().collection("brands");
  const own = await db2.findOne({ slug: SLUG });
  if (!own) throw new Error("Better Bathrooms brand not found in DB2");

  const clash = await db1.findOne({ slug: SLUG, _id: { $ne: own._id } });
  if (clash) throw new Error(`DB1 already has a different brand with slug "${SLUG}" (${clash._id}) — not touching it`);

  const now = new Date();
  const existing = await db1.findOne({ _id: own._id });
  if (!existing) {
    await db1.insertOne({ ...own, dataCluster: "secondary", isActive: false, updatedAt: now });
    console.log("registered in DB1 (hidden), pointing to DB2");
  }
  if (visible !== null) {
    await db1.updateOne({ _id: own._id }, { $set: { isActive: visible, updatedAt: now } });
    await db2.updateOne({ _id: own._id }, { $set: { isActive: visible, updatedAt: now } });
    console.log(visible ? "brand now VISIBLE on the storefront" : "brand now HIDDEN on the storefront");
  }
  const r = await db1.findOne({ _id: own._id });
  const products = await c2.db().collection("products").countDocuments({ brand: own._id });
  console.log({ id: String(r._id), name: r.name, slug: r.slug, dataCluster: r.dataCluster, isActive: r.isActive, productsInDB2: products });
  await Promise.all([c1.close(), c2.close()]);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
