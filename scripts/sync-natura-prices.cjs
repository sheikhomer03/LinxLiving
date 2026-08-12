/**
 * Sync Natura Flooring product prices from https://naturaflooring.co.uk/
 *
 * Updates product.price (pack/box) and specs.pricePerM2 (£/m² from PDP).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-natura-prices.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/sync-natura-prices.cjs
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");

const BASE = "https://naturaflooring.co.uk";
const BRAND_SLUG = "natura-flooring";
const DRY = process.env.DRY_RUN === "1";
const REPORT = path.join(__dirname, "_tmp-natura-price-sync-report.json");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; LinxLivingPriceSync/1.0; +https://linxliving.co.uk)",
      accept: "text/html,application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

function parsePriceFromHtml(html) {
  const out = { packPrice: 0, pricePerM2: 0 };

  const og =
    html.match(
      /property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i,
    );
  if (og) out.packPrice = Number(og[1]) || 0;

  const ldBlocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const m of ldBlocks) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : [data];
      for (const n of nodes) {
        const offer = n?.offers;
        const offers = Array.isArray(offer) ? offer : offer ? [offer] : [];
        for (const o of offers) {
          const p = Number(o?.price);
          if (p > 0 && !out.packPrice) out.packPrice = p;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // £69.99/m² (site retail unit price)
  const m2Matches = [
    ...html.matchAll(/£\s*([0-9]+(?:\.[0-9]{2})?)\s*\/\s*m²/gi),
    ...html.matchAll(/£\s*([0-9]+(?:\.[0-9]{2})?)\s*\/\s*m2/gi),
    ...html.matchAll(/£\s*([0-9]+(?:\.[0-9]{2})?)\s*\/\s*m(?![a-z])/gi),
  ];
  for (const m of m2Matches) {
    const n = Number(m[1]);
    if (n > 0 && n < 500) {
      out.pricePerM2 = n;
      break;
    }
  }

  // Theme JS sometimes: "price_per_sqm":"69.99" or similar
  const keyed = html.match(
    /(?:price[_-]?per[_-]?(?:sqm|m2|m²)|per[_-]?m2|unit[_-]?price)["']?\s*[:=]\s*["']?([0-9]+(?:\.[0-9]{2})?)/i,
  );
  if (keyed && !(out.pricePerM2 > 0)) {
    const n = Number(keyed[1]);
    if (n > 0 && n < 500) out.pricePerM2 = n;
  }

  return out;
}

function handleFromProduct(p) {
  if (p.specs?.naturaHandle) return String(p.specs.naturaHandle);
  const url = String(p.specs?.sourceUrl || "");
  const m = url.match(/\/products\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : "";
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required");
  await mongoose.connect(uri, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 30000,
  });
  const db = mongoose.connection.db;
  console.log(`Natura price sync${DRY ? " (DRY RUN)" : ""}`);

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand not found: ${BRAND_SLUG}`);

  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ name: 1, price: 1, specs: 1, category: 1 })
    .toArray();

  const rows = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let stillZero = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const handle = handleFromProduct(p);
    const label = `[${i + 1}/${products.length}]`;
    if (!handle) {
      failed += 1;
      rows.push({
        name: p.name,
        error: "no handle/sourceUrl",
      });
      console.log(`${label} SKIP no handle — ${p.name}`);
      continue;
    }

    try {
      let packPrice = 0;
      let pricePerM2 = 0;

      try {
        const data = await fetchJson(
          `${BASE}/products/${encodeURIComponent(handle)}.json`,
        );
        packPrice = Number(data?.product?.variants?.[0]?.price) || 0;
      } catch (e) {
        console.log(`${label} json fail: ${e.message}`);
      }

      // Always scrape HTML for £/m² (and pack fallback)
      const html = await fetchText(
        `${BASE}/products/${encodeURIComponent(handle)}`,
      );
      const scraped = parsePriceFromHtml(html);
      if (!(packPrice > 0) && scraped.packPrice > 0) packPrice = scraped.packPrice;
      if (scraped.pricePerM2 > 0) pricePerM2 = scraped.pricePerM2;

      const prevPrice = Number(p.price) || 0;
      const prevM2 = Number(p.specs?.pricePerM2) || 0;
      const nextPrice = packPrice > 0 ? packPrice : prevPrice;
      const nextM2 = pricePerM2 > 0 ? pricePerM2 : prevM2;

      const changed =
        (packPrice > 0 && packPrice !== prevPrice) ||
        (pricePerM2 > 0 && pricePerM2 !== prevM2);

      const row = {
        name: p.name,
        handle,
        category: p.category,
        prevPrice,
        prevPricePerM2: prevM2 || null,
        packPrice: packPrice || null,
        pricePerM2: pricePerM2 || null,
        changed,
        tradeOrHidden: !(packPrice > 0) && !(pricePerM2 > 0),
      };
      rows.push(row);

      if (!(packPrice > 0) && !(pricePerM2 > 0)) {
        stillZero += 1;
        console.log(`${label} NO PUBLIC PRICE — ${p.name}`);
      } else if (changed && !DRY) {
        const $set = { updatedAt: new Date(), priceSyncedAt: new Date() };
        if (packPrice > 0) $set.price = packPrice;
        if (pricePerM2 > 0) $set["specs.pricePerM2"] = pricePerM2;
        await db.collection("products").updateOne({ _id: p._id }, { $set });
        updated += 1;
        console.log(
          `${label} UPDATE ${p.name.slice(0, 48)} pack=£${packPrice || "-"} /m²=£${pricePerM2 || "-"} (was £${prevPrice}/${prevM2 || "-"})`,
        );
      } else if (changed && DRY) {
        updated += 1;
        console.log(
          `${label} [dry] ${p.name.slice(0, 48)} pack=£${packPrice || "-"} /m²=£${pricePerM2 || "-"}`,
        );
      } else {
        unchanged += 1;
        console.log(
          `${label} ok ${p.name.slice(0, 48)} pack=£${nextPrice} /m²=£${nextM2 || "-"}`,
        );
      }
    } catch (e) {
      failed += 1;
      rows.push({ name: p.name, handle, error: e.message });
      console.log(`${label} FAIL ${p.name}: ${e.message}`);
    }

    await delay(250);
  }

  const report = {
    at: new Date().toISOString(),
    dry: DRY,
    source: BASE,
    brand: { id: String(brand._id), name: brand.name, slug: brand.slug },
    stats: {
      products: products.length,
      updated,
      unchanged,
      failed,
      stillNoPublicPrice: stillZero,
    },
    products: rows,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(
    `Done. updated=${updated} unchanged=${unchanged} failed=${failed} noPublicPrice=${stillZero}`,
  );
  console.log(`Report → ${REPORT}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
