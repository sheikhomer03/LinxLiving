/**
 * Migrate Fakro Installation / Insulating / Flashing Finder / Finishes / Flashings
 * from Linx Glass Supabase → Living Mongo (matched by specs.sku).
 *
 * Source of truth (same as Linx Glass PDP):
 *   shop_products.installation_guide
 *   shop_products.insulating_set_price
 *   shop_products.flashing_finder (jsonb)
 *   shop_product_finishes (by sku)
 *   shop_product_flashings (by sku)
 *
 * Requires `.env` (Mongo) + `.env.migrate` (SOURCE_SUPABASE_*).
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/migrate-fakro-extras.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=50
 *   SKUS=879F02,LL-HIGHLY-INSULATED-METAL-SCISSOR-LOFT-LADDER
 *   CONCURRENCY=8
 */
const path = require("path");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.migrate"),
  override: false,
});

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const SOURCE_KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 8));
const SOURCE_TAG = "fakro-supabase";

const onlySkus = (process.env.SKUS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function supabasePaged(pathname, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const res = await fetch(`${SOURCE_URL}${pathname}`, {
      headers: { ...headers, Range: `${from}-${to}`, Prefer: "count=exact" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Supabase page ${res.status} ${pathname}: ${body.slice(0, 300)}`,
      );
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function normalizeFinder(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = cleanText(item.title);
      const description = cleanText(item.description);
      const imageUrl = cleanText(item.image_url || item.imageUrl);
      if (!title && !description && !imageUrl) return null;
      return {
        title: title || "Flashing option",
        description: description || "",
        imageUrl: imageUrl || "",
      };
    })
    .filter(Boolean);
}

function normalizeOptions(rows) {
  return (rows || [])
    .slice()
    .sort(
      (a, b) =>
        (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
        String(a.name || "").localeCompare(String(b.name || "")),
    )
    .map((row, index) => {
      const name = cleanText(row.name);
      if (!name) return null;
      return {
        name,
        imageUrl: cleanText(row.image_url) || "",
        priceAdjustment: Number(row.price_adjustment) || 0,
        sortOrder:
          typeof row.sort_order === "number" ? row.sort_order : index,
      };
    })
    .filter(Boolean);
}

function extrasSummary(extras) {
  return {
    guide: Boolean(extras.installationGuide),
    insulating: extras.insulatingSetPrice != null,
    finder: extras.flashingFinder.length,
    finishes: extras.finishes.length,
    flashings: extras.flashings.length,
  };
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const results = [];
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI");
  }

  console.log(
    `Migrate Fakro extras from Glass Supabase → Living Mongo${DRY_RUN ? " (DRY RUN)" : ""}`,
  );

  console.log("Loading shop_products extras…");
  const products = await supabasePaged(
    "/rest/v1/shop_products?select=sku,installation_guide,insulating_set_price,flashing_finder&order=sku.asc",
  );
  console.log(`  shop_products: ${products.length}`);

  console.log("Loading finishes…");
  const finishRows = await supabasePaged(
    "/rest/v1/shop_product_finishes?select=sku,name,image_url,price_adjustment,sort_order&order=sort_order.asc",
  );
  console.log(`  finishes: ${finishRows.length}`);

  console.log("Loading flashings…");
  const flashingRows = await supabasePaged(
    "/rest/v1/shop_product_flashings?select=sku,name,image_url,price_adjustment,sort_order&order=sort_order.asc",
  );
  console.log(`  flashings: ${flashingRows.length}`);

  const bySku = new Map();
  for (const row of products) {
    const sku = cleanText(row.sku);
    if (!sku) continue;
    bySku.set(sku.toLowerCase(), {
      installationGuide: cleanText(row.installation_guide) || null,
      insulatingSetPrice:
        row.insulating_set_price == null || row.insulating_set_price === ""
          ? null
          : Number(row.insulating_set_price),
      flashingFinder: normalizeFinder(row.flashing_finder),
      finishes: [],
      flashings: [],
    });
  }

  const finishesBySku = new Map();
  for (const row of finishRows) {
    const sku = cleanText(row.sku).toLowerCase();
    if (!sku) continue;
    if (!finishesBySku.has(sku)) finishesBySku.set(sku, []);
    finishesBySku.get(sku).push(row);
  }
  const flashingsBySku = new Map();
  for (const row of flashingRows) {
    const sku = cleanText(row.sku).toLowerCase();
    if (!sku) continue;
    if (!flashingsBySku.has(sku)) flashingsBySku.set(sku, []);
    flashingsBySku.get(sku).push(row);
  }

  for (const [sku, extras] of bySku) {
    extras.finishes = normalizeOptions(finishesBySku.get(sku) || []);
    extras.flashings = normalizeOptions(flashingsBySku.get(sku) || []);
    if (
      extras.insulatingSetPrice != null &&
      !Number.isFinite(extras.insulatingSetPrice)
    ) {
      extras.insulatingSetPrice = null;
    }
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection("products");

  const query = { "specs.source": SOURCE_TAG };
  if (onlySkus.length) {
    query["specs.sku"] = { $in: onlySkus };
  }

  let mongoProducts = await col
    .find(query, { projection: { _id: 1, name: 1, specs: 1 } })
    .toArray();
  if (LIMIT > 0) mongoProducts = mongoProducts.slice(0, LIMIT);

  console.log(`Living Fakro products to update: ${mongoProducts.length}`);

  let updated = 0;
  let skipped = 0;
  let missingSource = 0;
  let withAny = 0;

  await mapPool(mongoProducts, CONCURRENCY, async (doc) => {
    const sku = cleanText(doc.specs?.sku);
    if (!sku) {
      skipped += 1;
      return;
    }
    const extras = bySku.get(sku.toLowerCase());
    if (!extras) {
      missingSource += 1;
      return;
    }

    const summary = extrasSummary(extras);
    if (
      summary.guide ||
      summary.insulating ||
      summary.finder ||
      summary.finishes ||
      summary.flashings
    ) {
      withAny += 1;
    }

    if (DRY_RUN) {
      if (updated < 5 || onlySkus.length) {
        console.log(
          `  [dry] ${sku} → guide=${summary.guide} insulating=${summary.insulating} finder=${summary.finder} finishes=${summary.finishes} flashings=${summary.flashings}`,
        );
      }
      updated += 1;
      return;
    }

    await col.updateOne(
      { _id: doc._id },
      {
        $set: {
          installationGuide: extras.installationGuide,
          insulatingSetPrice: extras.insulatingSetPrice,
          flashingFinder: extras.flashingFinder,
          finishes: extras.finishes,
          flashings: extras.flashings,
          updatedAt: new Date(),
        },
      },
    );
    updated += 1;
    if (updated % 100 === 0) {
      console.log(`  … ${updated}/${mongoProducts.length}`);
    }
  });

  // Spot-check known SKUs
  for (const sku of [
    "879F02",
    "LL-HIGHLY-INSULATED-METAL-SCISSOR-LOFT-LADDER",
  ]) {
    const src = bySku.get(sku.toLowerCase());
    const live = await col.findOne(
      { "specs.sku": sku },
      {
        projection: {
          name: 1,
          installationGuide: 1,
          insulatingSetPrice: 1,
          flashingFinder: 1,
          finishes: 1,
          flashings: 1,
        },
      },
    );
    console.log(`\nVerify ${sku}`);
    console.log("  Glass:", src ? extrasSummary(src) : "MISSING");
    if (live && !DRY_RUN) {
      console.log(
        "  Living:",
        extrasSummary({
          installationGuide: live.installationGuide,
          insulatingSetPrice: live.insulatingSetPrice,
          flashingFinder: live.flashingFinder || [],
          finishes: live.finishes || [],
          flashings: live.flashings || [],
        }),
      );
      if (live.installationGuide) {
        console.log(
          "  guide preview:",
          String(live.installationGuide).slice(0, 100) + "…",
        );
      }
      if (live.insulatingSetPrice != null) {
        console.log("  insulating:", live.insulatingSetPrice);
      }
      if ((live.flashings || []).length) {
        console.log(
          "  first flashing:",
          live.flashings[0].name,
          live.flashings[0].priceAdjustment,
        );
      }
    }
  }

  console.log("\nDone:", {
    updated,
    skipped,
    missingSource,
    withAnyExtras: withAny,
    dryRun: DRY_RUN,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
