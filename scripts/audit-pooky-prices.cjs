/**
 * Compare stored Pooky prices against the live site — both the product price
 * and the component prices inside the shade / base / pendant / wall-fitting
 * pickers.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-pooky-prices.cjs
 *   SAMPLE=200      — products to check (0 = all)
 *   COMPONENTS=40   — component prices to spot-check per product
 *   FIX=1           — write corrected prices back
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const PRODUCTS_DB =
  process.env.POOKY_PRODUCTS_DB ||
  "https://graphql-server-uk-464125e5708d.herokuapp.com/";
const SAMPLE = Number(process.env.SAMPLE ?? 200);
const COMPONENTS = Number(process.env.COMPONENTS ?? 40);
const GQL_BATCH = Number(process.env.GQL_BATCH || 40);
const FIX = process.env.FIX === "1";
const REPORT = path.join(__dirname, "_tmp-pooky-price-report.json");

async function gql(query, variables = {}) {
  const res = await fetch(PRODUCTS_DB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://www.pooky.com",
      Referer: "https://www.pooky.com/",
      "User-Agent": "Mozilla/5.0 LinxPookyPriceAudit/1.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const PRICE_QUERY = `
  query ($handles: [String!]!) {
    productsByHandle(handle: $handles, take: 200) {
      handle
      variants { sku price compareAtPrice }
    }
  }
`;

/** Live price by handle, in pounds. */
async function livePrices(handles) {
  const out = new Map();
  for (let i = 0; i < handles.length; i += GQL_BATCH) {
    const batch = handles.slice(i, i + GQL_BATCH);
    try {
      const data = await gql(PRICE_QUERY, { handles: batch });
      for (const p of data.productsByHandle || []) {
        const v = (p.variants || [])[0];
        if (!v) continue;
        out.set(p.handle, {
          price: Number(v.price),
          compareAt: Number(v.compareAtPrice) || null,
          sku: v.sku,
        });
      }
    } catch (e) {
      console.log(`  price batch ${i} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}

const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "pooky" });
  const P = db.collection("products");

  const cursor = P.find({ brand: brand._id }).project({
    name: 1,
    price: 1,
    specs: 1,
    variants: 1,
    bases: 1,
    shades: 1,
    pendants: 1,
    wallFittings: 1,
  });
  let products = await cursor.toArray();
  if (SAMPLE > 0) products = products.slice(0, SAMPLE);
  console.log(`Auditing ${products.length} products…`);

  // The comparison phase is long and network-bound; holding the Mongo socket
  // open through it just gets the connection reset.
  await mongoose.disconnect();

  // 1) Product prices
  const handles = products.map((p) => p.specs?.pookyHandle).filter(Boolean);
  const live = await livePrices(handles);
  console.log(`live prices resolved: ${live.size}/${handles.length}`);

  const priceGaps = [];
  for (const p of products) {
    const h = p.specs?.pookyHandle;
    const l = live.get(h);
    if (!l) continue;
    if (!near(p.price, l.price)) {
      priceGaps.push({
        handle: h,
        name: p.name,
        mine: p.price,
        live: l.price,
        salePercent: p.specs?.salePercent ?? null,
        saleOriginal: p.specs?.saleOriginalPrice ?? null,
      });
    }
  }

  // 2) Component prices inside the pickers
  const compHandles = new Set();
  for (const p of products) {
    for (const field of ["bases", "shades", "pendants", "wallFittings"]) {
      for (const c of (p[field] || []).slice(0, COMPONENTS)) {
        if (c?.handle) compHandles.add(c.handle);
      }
    }
  }
  console.log(`checking ${compHandles.size} distinct component prices…`);
  const liveComp = await livePrices([...compHandles]);

  const compGaps = [];
  let compChecked = 0;
  for (const p of products) {
    for (const field of ["bases", "shades", "pendants", "wallFittings"]) {
      for (const c of (p[field] || []).slice(0, COMPONENTS)) {
        const l = c?.handle ? liveComp.get(c.handle) : null;
        if (!l) continue;
        compChecked++;
        if (!near(c.price, l.price)) {
          compGaps.push({
            product: p.specs?.pookyHandle,
            field,
            component: c.handle,
            mine: c.price,
            live: l.price,
          });
        }
      }
    }
  }

  console.log(`\nPRODUCT PRICES: ${products.length} checked, ${priceGaps.length} differ`);
  for (const g of priceGaps.slice(0, 15)) {
    console.log(
      `  ${g.name.slice(0, 46).padEnd(46)} mine £${g.mine} live £${g.live}` +
        (g.salePercent ? `  (local sale ${g.salePercent}%)` : ""),
    );
  }

  console.log(`\nCOMPONENT PRICES: ${compChecked} checked, ${compGaps.length} differ`);
  const byComponent = new Map();
  for (const g of compGaps) {
    if (!byComponent.has(g.component)) byComponent.set(g.component, g);
  }
  for (const g of [...byComponent.values()].slice(0, 15)) {
    console.log(
      `  ${g.field.padEnd(12)} ${g.component.slice(0, 44).padEnd(44)} mine £${g.mine} live £${g.live}`,
    );
  }
  console.log(`  distinct components wrong: ${byComponent.size}`);

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        productsChecked: products.length,
        productPriceGaps: priceGaps,
        componentsChecked: compChecked,
        componentPriceGaps: compGaps,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport: ${REPORT}`);

  if (FIX && (priceGaps.length || compGaps.length)) {
    await connectMongo(process.env.MONGODB_URI);
    const P = mongoose.connection.db.collection("products");
    let fixed = 0;
    for (const g of priceGaps) {
      await P.updateOne(
        { brand: brand._id, "specs.pookyHandle": g.handle },
        { $set: { price: g.live, updatedAt: new Date() } },
      );
      fixed++;
    }
    // Component lists are embedded, so rewrite each product's arrays once.
    const touched = new Set(compGaps.map((g) => g.product));
    for (const handle of touched) {
      const doc = await P.findOne({ brand: brand._id, "specs.pookyHandle": handle });
      const $set = {};
      for (const field of ["bases", "shades", "pendants", "wallFittings"]) {
        if (!(doc[field] || []).length) continue;
        $set[field] = doc[field].map((c) => {
          const l = c?.handle ? liveComp.get(c.handle) : null;
          return l && !near(c.price, l.price) ? { ...c, price: l.price } : c;
        });
      }
      if (Object.keys($set).length) {
        await P.updateOne({ _id: doc._id }, { $set });
        fixed++;
      }
    }
    console.log(`FIX applied to ${fixed} documents`);
    await mongoose.disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
