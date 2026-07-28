/**
 * Sync Mongo products to Trades Spectra Price List 2026.xlsx:
 * - update prices for spreadsheet products
 * - create any missing rows
 * - delete products not in the spreadsheet
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/sync-spectra-from-excel.cjs
 * Dry run:  node --require ./scripts/mongo-dns.cjs scripts/sync-spectra-from-excel.cjs --dry
 */
const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const XLSX = require("xlsx");
const mongoose = require("mongoose");

const EXCEL_PATH = path.join(
  __dirname,
  "..",
  "Trades Spectra Price List 2026.xlsx",
);
const SOURCE = "Spectra Trade Price List 2026";
const STOCK_DEFAULT = 50;

/** Excel typos / corrupted cells → canonical DB name */
const NAME_ALIASES = {
  ristianoightrey: "Cristiano Light Grey",
  cristianolightgrey: "Cristiano Light Grey",
  ryreyattarving: "Fury Grey LT (Matt Carving)",
  furygreyltmattcarving: "Fury Grey LT (Matt Carving)",
  furygreymattcarving: "Fury Grey LT (Matt Carving)",
};

function cleanName(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00A0]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function letters(s) {
  return cleanName(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/creama/g, "crema")
    .replace(/florin/g, "florian")
    .replace(/traventine/g, "travertine")
    .replace(/[^a-z0-9]/g, "");
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readExcelRows() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    defval: "",
  });

  const mapped = rows
    .map((r) => {
      let name = cleanName(r["Name:"]);
      const key = letters(name);
      if (NAME_ALIASES[key]) name = NAME_ALIASES[key];

      const finish = cleanName(r["Finish:"]) || "Gloss";
      const size = cleanName(r["Size:"]);
      const sqm = cleanName(r["SQM Per Box"]);
      const priceEx = Number(r["Price ex VAT"]);
      const promoRaw = r["Promotion!"];
      const promo =
        promoRaw === "" || promoRaw == null ? null : Number(promoRaw);

      return {
        name,
        finish,
        size,
        sqm,
        priceEx,
        promo: Number.isFinite(promo) ? promo : null,
        price: priceEx,
        key: letters(name),
      };
    })
    .filter((r) => r.name && Number.isFinite(r.price) && r.price > 0);

  // Unique by normalized letters key (keeps first occurrence)
  const unique = [];
  const seen = new Set();
  for (const row of mapped) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    unique.push(row);
  }
  return unique;
}

function findDbMatches(row, products) {
  const exact = products.filter((p) => letters(p.name) === row.key);
  if (exact.length) return exact;

  // Corrupted Excel names (missing letters) — substring either way
  const fuzzy = products.filter((p) => {
    const k = letters(p.name);
    return (
      k.includes(row.key) ||
      row.key.includes(k) ||
      (row.key.length >= 8 && k.includes(row.key.slice(0, 8)))
    );
  });
  return fuzzy;
}

async function ensureFinishMenu(db, finish) {
  const menus = db.collection("menus");
  const slug = slugify(finish);
  let doc = await menus.findOne({ slug, parent: null });
  if (!doc) {
    const now = new Date();
    const insert = {
      name: finish,
      slug,
      parent: null,
      order: 50,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    const result = await menus.insertOne(insert);
    doc = { ...insert, _id: result.insertedId };
  }
  return doc;
}

async function main() {
  const dry = process.argv.includes("--dry");
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  const excelRows = readExcelRows();
  console.log(`Excel unique products: ${excelRows.length}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const allProducts = await productsCol.find({}).toArray();
  console.log(`DB products before: ${allProducts.length}`);

  const keepIds = new Set();
  const report = {
    updated: [],
    created: [],
    deleted: [],
    unmatchedExcel: [],
    duplicateRemoved: [],
  };

  for (const row of excelRows) {
    const matches = findDbMatches(row, allProducts);
    const menu = await ensureFinishMenu(db, row.finish);
    const category = menu.slug;

    if (!matches.length) {
      if (dry) {
        report.created.push(`${row.name} (£${row.price}) [dry]`);
        continue;
      }
      const now = new Date();
      const doc = {
        name: row.name,
        description: `${row.name} — ${row.finish} ${row.size}`.trim(),
        price: row.price,
        stock: STOCK_DEFAULT,
        category,
        subCategory: "",
        brand: null,
        images: [],
        tagline: "",
        schematicImage: "",
        specs: {
          source: SOURCE,
          size: row.size,
          finish: row.finish,
          sqmPerBox: row.sqm,
          priceExVat: row.priceEx,
          ...(row.promo != null ? { promotionPrice: row.promo } : {}),
        },
        showSpecs: true,
        shopifyProductId: null,
        shopifyVariantId: null,
        shopifySyncError: null,
        shopifySyncedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await productsCol.insertOne(doc);
      keepIds.add(String(result.insertedId));
      report.created.push(`${row.name} (£${row.price})`);
      continue;
    }

    // Prefer match with closest price, then highest stock, then oldest
    matches.sort((a, b) => {
      const da = Math.abs(Number(a.price) - row.price);
      const dbp = Math.abs(Number(b.price) - row.price);
      if (da !== dbp) return da - dbp;
      return Number(b.stock || 0) - Number(a.stock || 0);
    });

    const primary = matches[0];
    keepIds.add(String(primary._id));

    for (const extra of matches.slice(1)) {
      keepIds.delete(String(extra._id));
      if (dry) {
        report.duplicateRemoved.push(
          `${extra.name} (£${extra.price}) id=${extra._id} [dry]`,
        );
      } else {
        await productsCol.deleteOne({ _id: extra._id });
        report.duplicateRemoved.push(
          `${extra.name} (£${extra.price}) id=${extra._id}`,
        );
      }
    }

    const specs = {
      ...(primary.specs && typeof primary.specs === "object"
        ? primary.specs
        : {}),
      source: SOURCE,
      size: row.size || primary.specs?.size,
      finish: row.finish || primary.specs?.finish,
      sqmPerBox: row.sqm || primary.specs?.sqmPerBox,
      priceExVat: row.priceEx,
    };
    if (row.promo != null) specs.promotionPrice = row.promo;
    else delete specs.promotionPrice;

    const needsUpdate =
      Number(primary.price) !== row.price ||
      primary.category !== category ||
      primary.name !== row.name;

    if (dry) {
      report.updated.push(
        `${row.name}: £${primary.price} → £${row.price}${needsUpdate ? "" : " (specs only)"} [dry]`,
      );
      continue;
    }

    await productsCol.updateOne(
      { _id: primary._id },
      {
        $set: {
          name: row.name,
          price: row.price,
          category,
          specs,
          updatedAt: new Date(),
        },
      },
    );
    report.updated.push(`${row.name}: £${primary.price} → £${row.price}`);
  }

  // Delete anything not kept
  for (const p of allProducts) {
    if (keepIds.has(String(p._id))) continue;
    // Also skip if we already deleted as duplicate above
    if (
      report.duplicateRemoved.some((line) => line.includes(String(p._id)))
    ) {
      continue;
    }
    if (dry) {
      report.deleted.push(`${p.name} (£${p.price}) [dry]`);
    } else {
      await productsCol.deleteOne({ _id: p._id });
      report.deleted.push(`${p.name} (£${p.price})`);
    }
  }

  const after = dry
    ? allProducts.length
    : await productsCol.countDocuments();

  console.log("\n--- Report ---");
  console.log(`Updated: ${report.updated.length}`);
  console.log(`Created: ${report.created.length}`);
  console.log(`Duplicates removed: ${report.duplicateRemoved.length}`);
  console.log(`Deleted (extras): ${report.deleted.length}`);
  if (report.created.length) {
    console.log("\nCreated:");
    report.created.forEach((l) => console.log("  +", l));
  }
  if (report.deleted.length) {
    console.log("\nDeleted extras:");
    report.deleted.forEach((l) => console.log("  -", l));
  }
  if (report.duplicateRemoved.length) {
    console.log("\nDuplicate rows removed:");
    report.duplicateRemoved.forEach((l) => console.log("  -", l));
  }

  // Verify every excel row has a DB product with matching price
  const finalProducts = dry
    ? allProducts
    : await productsCol.find({}).toArray();
  const priceMismatches = [];
  const stillMissing = [];
  for (const row of excelRows) {
    const hits = finalProducts.filter((p) => letters(p.name) === row.key);
    const fuzzy =
      hits.length > 0
        ? hits
        : finalProducts.filter((p) => {
            const k = letters(p.name);
            return k.includes(row.key) || row.key.includes(k);
          });
    if (!fuzzy.length) stillMissing.push(row.name);
    else if (Number(fuzzy[0].price) !== row.price) {
      priceMismatches.push(
        `${row.name}: db=£${fuzzy[0].price} excel=£${row.price}`,
      );
    }
  }

  console.log(`\nDB products after: ${after}`);
  console.log(`Excel coverage missing: ${stillMissing.length}`);
  console.log(`Price mismatches: ${priceMismatches.length}`);
  if (stillMissing.length) stillMissing.forEach((n) => console.log("  ?", n));
  if (priceMismatches.length)
    priceMismatches.forEach((n) => console.log("  !", n));

  if (dry) console.log("\nDry run only — no changes made.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
