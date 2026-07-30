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
  const p = await db.collection("products").findOne({
    _id: new mongoose.Types.ObjectId("6a68f90ce6f26f4a21190345"),
  });
  console.log(
    JSON.stringify(
      {
        name: p?.name,
        sku: p?.specs?.sku,
        description: p?.description,
        specLabels: Object.keys(p?.specs || {}).filter(
          (k) =>
            ![
              "sku",
              "source",
              "sourceId",
              "productCode",
              "baseTitle",
              "salePercent",
              "size",
            ].includes(k),
        ),
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
