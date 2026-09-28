/**
 * Import the aicabathrooms.co.uk capture into Mongo under the "Aica Bathrooms" brand.
 * 
 * Env:
 *   DRY_RUN=1   parse and report, write nothing
 *   LIMIT=n     only the first n captured products
 *   ACTIVATE=1  set the brand live once the import succeeds
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ACTIVATE = process.env.ACTIVATE === "1";

const SOURCE_TAG = "aica-scrape";
const BRAND_NAME = "Aica Bathrooms";
const DEFAULT_STOCK = 500;

const DATA = process.env.AICA_DATA || path.join(__dirname, "../.scratch/aica");
const PDP_FILE = path.join(DATA, "aica-pdp.jsonl");

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

function readCapture() {
  const rows = [];
  let bad = 0;
  if (!fs.existsSync(PDP_FILE)) return { rows, bad };
  for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      bad += 1;
    }
  }
  return { rows, bad };
}

// Map Aica collections to our internal departments/categories
function mapCategory(collections) {
  const map = {
    "bath-screens": { d: "Bathroom", c: "Bath Screens" },
    "bathroom-suites": { d: "Bathroom", c: "Bathroom Suites" },
    "bathroom-vanity-units": { d: "Bathroom", c: "Vanity Units" },
    "radiators": { d: "Heating", c: "Radiators" },
    "accessories": { d: "Bathroom", c: "Bathroom Accessories" },
    "led-mirrors": { d: "Bathroom", c: "Bathroom Mirrors" },
    "mirrors": { d: "Bathroom", c: "Bathroom Mirrors" },
    "shower-enclosures": { d: "Bathroom", c: "Shower Enclosures" },
    "shower-trays": { d: "Bathroom", c: "Shower Trays" },
    "taps": { d: "Bathroom", c: "Bathroom Taps" },
    "toilets": { d: "Bathroom", c: "Toilets" },
  };

  for (const handle of collections) {
    for (const [key, val] of Object.entries(map)) {
      if (handle.includes(key)) return val;
    }
  }
  // Fallback
  return { d: "Bathroom", c: "Other" };
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) throw new Error("no capture at " + PDP_FILE);
  const { rows, bad } = readCapture();

  const usable = rows.filter((r) => !r.error && r.name);
  console.log("capture: " + rows.length + " lines (" + usable.length + " usable, " + bad + " unparsable)");

  // Always use MONGODB_URL2 as requested by user ("db 2")
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  
  let brand = await db.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) {
    console.log(`Creating brand ${BRAND_NAME}`);
    if (!DRY_RUN) {
      await db.collection("brands").insertOne({ name: BRAND_NAME, dataCluster: "secondary", isActive: false, createdAt: new Date() });
      brand = await db.collection("brands").findOne({ name: BRAND_NAME });
    } else {
      brand = { _id: "DRY_RUN_BRAND_ID" };
    }
  }

  const productsCol = db.collection("products");
  const entries = LIMIT === Infinity ? usable : usable.slice(0, LIMIT);

  let created = 0;
  let updated = 0;
  const catCount = new Map();

  const logStream = fs.createWriteStream(path.join(DATA, "import-progress.log"), { flags: 'w' });
  const log = (msg) => {
    console.log(msg);
    logStream.write(msg + "\n");
  };

  log(`Starting import to db2 for ${entries.length} products...`);

  for (const r of entries) {
    const mapped = mapCategory(r.collectionHandles || []);
    const department = mapped.d;
    const category = mapped.c;

    catCount.set(`${department} > ${category}`, (catCount.get(`${department} > ${category}`) || 0) + 1);

    const specRows = (r.specs || []).filter((s) => s.label && s.value);
    const specMap = Object.fromEntries(specRows.map((s) => [s.label, s.value]));

    // Handle variants safely
    const variants = (r.variants || []).map((v, i) => ({
      name: clean(v.title),
      sku: v.sku || "",
      options: v.optionMap || {},
      price: typeof v.price === "number" ? v.price : null,
      tradePrice: null,
      imageUrl: v.featuredImage || "",
      isDefault: i === 0,
      available: v.available !== false,
      sourceUrl: v.url,
      position: i,
    }));

    const description = specRows.map(s => `${s.label}: ${s.value}`).join("\n") || r.descriptionLines?.join("\n") || "";
    const price = typeof r.priceMin === "number" ? r.priceMin : (variants.find(v => v.price != null)?.price || 0);

    const now = new Date();
    const doc = {
      name: clean(r.name),
      description,
      shortDescription: clean(description).slice(0, 300),
      price: price,
      priceCurrency: "GBP",
      images: (r.images || []).map(i => i.url),
      department: department,
      category: category,
      categories: [category],
      brand: brand._id,
      brands: [brand._id],
      supplierSku: r.variants?.[0]?.sku || "",
      variants,
      stock: DEFAULT_STOCK,
      isOutOfStock: !r.available,
      stockStatus: r.available ? "in_stock" : "out_of_stock",
      sourceUrl: r.sourceUrl,
      sourceProductId: r.id || "",
      specs: Object.assign({}, specMap, {
        source: SOURCE_TAG,
        sourceUrl: r.sourceUrl,
        importedAt: now.toISOString(),
      }),
      updatedAt: now,
    };

    if (DRY_RUN) {
      created += 1;
      log(`[dry] ${doc.name} -> ${department} > ${category}`);
      continue;
    }

    const existing = await productsCol.findOne({ "specs.source": SOURCE_TAG, sourceUrl: r.sourceUrl });
    
    if (existing) {
      await productsCol.updateOne({ _id: existing._id }, { $set: doc });
      updated += 1;
      log(`[db2] Updated: ${doc.name}`);
    } else {
      await productsCol.insertOne(Object.assign({ createdAt: now }, doc));
      created += 1;
      log(`[db2] Inserted: ${doc.name}`);
    }
  }

  log(`\nImport complete: ${created} created, ${updated} updated`);
  log(`Category Breakdown:`);
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${k.padEnd(30)} ${v}`);
  }

  if (ACTIVATE && !DRY_RUN) {
    await db.collection("brands").updateOne({ _id: brand._id }, { $set: { isActive: true, updatedAt: new Date() } });
    log(`Brand "${BRAND_NAME}" is now ACTIVE`);
  }
  
  logStream.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
