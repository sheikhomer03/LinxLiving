const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");
  const brands = db.collection("brands");

  const brandDocs = await brands
    .find({}, { projection: { _id: 1, name: 1, slug: 1 } })
    .toArray();
  const brandMap = Object.fromEntries(
    brandDocs.map((b) => [String(b._id), b.slug || b.name]),
  );

  const all = await products
    .find({}, { projection: { description: 1, brand: 1 } })
    .toArray();

  const byBrand = {};
  let empty = 0;
  let shortOnly = 0;
  let rich = 0;

  for (const p of all) {
    const key = p.brand ? brandMap[String(p.brand)] || "unknown" : "no-brand";
    if (!byBrand[key]) {
      byBrand[key] = { total: 0, empty: 0, shortOnly: 0, rich: 0 };
    }
    byBrand[key].total++;

    const d = String(p.description || "").trim();
    if (!d) {
      empty++;
      byBrand[key].empty++;
      continue;
    }

    // Code-like / stub only (single short line, no real paragraphs)
    if (!d.includes("\n") && d.length < 80) {
      shortOnly++;
      byBrand[key].shortOnly++;
    } else {
      rich++;
      byBrand[key].rich++;
    }
  }

  console.log(
    JSON.stringify(
      {
        total: all.length,
        emptyOrMissing: empty,
        shortStubOnly: shortOnly,
        hasRealDescription: rich,
        byBrand,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
