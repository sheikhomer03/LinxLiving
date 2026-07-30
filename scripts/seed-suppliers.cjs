/**
 * Seed Supplier docs for each brand and link brand.supplier.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/seed-suppliers.cjs
 */
const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const SEEDS = [
  {
    brandSlug: "spectra",
    name: "Spectra",
    slug: "spectra",
    website: "",
    notes: "Tile / flooring supplier for Spectra brand catalogue.",
    order: 10,
  },
  {
    brandSlug: "fakro",
    name: "FAKRO",
    slug: "fakro",
    website: "https://www.fakro.co.uk",
    notes: "Roof windows and loft ladders supplier.",
    order: 20,
  },
  {
    brandSlug: "sterlingbuild",
    name: "Sterlingbuild",
    slug: "sterlingbuild",
    website: "https://www.sterlingbuild.co.uk",
    notes: "Building materials supplier catalogue.",
    order: 30,
  },
  {
    brandSlug: "porcelanosagrupo",
    name: "PORCELANOSA Grupo",
    slug: "porcelanosagrupo",
    website: "https://www.porcelanosa.com/en/",
    notes: "PORCELANOSA Grupo — price on request / enquiry.",
    order: 40,
  },
  {
    brandSlug: "noken",
    name: "Noken",
    slug: "noken",
    website: "https://www.noken.com/en",
    notes: "Noken bathroom — price on request / enquiry.",
    order: 50,
  },
  {
    brandSlug: "linx-trade",
    name: "LINX TRADE",
    slug: "linx-trade",
    website: "",
    notes: "Internal / trade brand supplier.",
    order: 60,
  },
];

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const suppliers = db.collection("suppliers");
  const brands = db.collection("brands");
  const now = new Date();

  for (const seed of SEEDS) {
    const brand = await brands.findOne({ slug: seed.brandSlug });
    if (!brand) {
      console.log(`skip brand missing: ${seed.brandSlug}`);
      continue;
    }

    let supplier = await suppliers.findOne({ slug: seed.slug });
    if (!supplier) {
      const insert = {
        name: seed.name,
        slug: seed.slug || slugify(seed.name),
        contactName: "",
        email: "",
        phone: "",
        whatsapp: "",
        website: seed.website || "",
        address: "",
        notes: seed.notes || "",
        logo: brand.image || "",
        defaultLeadTimeDays: null,
        isActive: true,
        order: seed.order ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      const r = await suppliers.insertOne(insert);
      supplier = { ...insert, _id: r.insertedId };
      console.log(`created supplier ${seed.name}`);
    } else {
      await suppliers.updateOne(
        { _id: supplier._id },
        {
          $set: {
            isActive: true,
            website: supplier.website || seed.website || "",
            notes: supplier.notes || seed.notes || "",
            updatedAt: now,
            ...(supplier.logo ? {} : { logo: brand.image || "" }),
          },
        },
      );
      console.log(`updated supplier ${seed.name}`);
    }

    await brands.updateOne(
      { _id: brand._id },
      { $set: { supplier: supplier._id, updatedAt: now } },
    );
    console.log(`  linked brand ${brand.slug} → supplier ${seed.slug}`);
  }

  const count = await suppliers.countDocuments();
  console.log(JSON.stringify({ suppliers: count }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
