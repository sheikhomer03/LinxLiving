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
  const p = await db.collection("products").findOne(
    { "specs.sku": "879F02" },
    { projection: { name: 1, description: 1, specs: 1, images: 1 } },
  );
  const gif = await db.collection("products").findOne(
    { "specs.sku": "ADFAAAA22602" },
    { projection: { name: 1, images: 1 } },
  );
  console.log(
    JSON.stringify(
      {
        sample: {
          sku: "879F02",
          descPreview: (p?.description || "").slice(0, 180),
          specKeys: Object.keys(p?.specs || {}),
        },
        gif: {
          sku: "ADFAAAA22602",
          image: (gif?.images || [])[0]?.slice(0, 100),
        },
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
