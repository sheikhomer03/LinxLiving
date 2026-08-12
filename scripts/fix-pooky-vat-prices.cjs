/**
 * Pooky's Shopify JSON is tax-exclusive, so the import stored prices 20% below
 * what pooky.com displays. This resets every product, variant and picker
 * component to the supplier's inc-VAT price and recomputes the local sale
 * "was" price off the new base.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-pooky-vat-prices.cjs
 *   DRY_RUN=1   — report only
 *   LIMIT=50    — cap products touched
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const PRODUCTS_DB =
  process.env.POOKY_PRODUCTS_DB ||
  "https://graphql-server-uk-464125e5708d.herokuapp.com/";
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const GQL_BATCH = Number(process.env.GQL_BATCH || 40);
/** Fallback when the supplier has no live row for a handle any more. */
const VAT = 1.2;
const ROLLBACK = path.join(
  __dirname,
  `rollback-pooky-vat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

const money = (n) => Math.round(Number(n) * 100) / 100;

async function gql(query, variables = {}) {
  const res = await fetch(PRODUCTS_DB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://www.pooky.com",
      Referer: "https://www.pooky.com/",
      "User-Agent": "Mozilla/5.0 LinxPookyVatFix/1.0",
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

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "pooky" });
  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({
      name: 1,
      price: 1,
      specs: 1,
      variants: 1,
      bases: 1,
      shades: 1,
      pendants: 1,
      wallFittings: 1,
    })
    .toArray();
  if (LIMIT > 0) products = products.slice(0, LIMIT);
  console.log(`Loaded ${products.length} Pooky products`);
  await mongoose.disconnect();

  // One live price table keyed by handle covers products and components alike.
  const handles = [
    ...new Set([
      ...products.map((p) => p.specs?.pookyHandle).filter(Boolean),
      ...products.flatMap((p) =>
        ["bases", "shades", "pendants", "wallFittings"].flatMap((f) =>
          (p[f] || []).map((c) => c?.handle).filter(Boolean),
        ),
      ),
    ]),
  ];
  console.log(`Fetching live inc-VAT prices for ${handles.length} handles…`);

  const live = new Map();
  for (let i = 0; i < handles.length; i += GQL_BATCH) {
    const batch = handles.slice(i, i + GQL_BATCH);
    try {
      const data = await gql(PRICE_QUERY, { handles: batch });
      for (const p of data.productsByHandle || []) {
        const v = (p.variants || [])[0];
        if (v) {
          live.set(p.handle, {
            price: Number(v.price),
            compareAt: Number(v.compareAtPrice) || null,
          });
        }
      }
    } catch (e) {
      console.log(`  batch ${i} failed: ${e.message}`);
    }
    if (i % (GQL_BATCH * 20) === 0 && i) {
      console.log(`  …${i}/${handles.length}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`live prices resolved: ${live.size}/${handles.length}`);

  /** Supplier price when known, otherwise the ex-VAT figure grossed up. */
  const incVat = (handle, current) => {
    const l = handle ? live.get(handle) : null;
    if (l && l.price > 0) return money(l.price);
    return current > 0 ? money(current * VAT) : current;
  };

  const rollback = [];
  const updates = [];
  let componentsChanged = 0;

  for (const p of products) {
    const handle = p.specs?.pookyHandle;
    const oldPrice = Number(p.price) || 0;
    const newPrice = incVat(handle, oldPrice);
    const $set = {};
    const before = { _id: String(p._id), price: oldPrice };

    if (newPrice > 0 && Math.abs(newPrice - oldPrice) >= 0.005) {
      $set.price = newPrice;
    }

    // Sale bookkeeping is anchored to the base price, so move it together.
    const specs = { ...(p.specs || {}) };
    let specsTouched = false;
    if (Number(specs.shopifyListPrice) > 0) {
      before.shopifyListPrice = specs.shopifyListPrice;
      specs.shopifyListPrice = incVat(handle, Number(specs.shopifyListPrice));
      specsTouched = true;
    }
    if (Number(specs.saleOriginalPrice) > 0) {
      before.saleOriginalPrice = specs.saleOriginalPrice;
      specs.saleOriginalPrice = newPrice || money(specs.saleOriginalPrice * VAT);
      specsTouched = true;
    }
    if (Number(specs.compareAtPrice) > 0) {
      before.compareAtPrice = specs.compareAtPrice;
      const pct = Number(specs.salePercent) || 0;
      // "raise-was-keep-price": was = price / (1 - discount)
      specs.compareAtPrice =
        pct > 0 && pct < 100
          ? money((newPrice || oldPrice * VAT) / (1 - pct / 100))
          : money(specs.compareAtPrice * VAT);
      specsTouched = true;
    }
    if (Number(specs.shopifyCompareAt) > 0) {
      before.shopifyCompareAt = specs.shopifyCompareAt;
      specs.shopifyCompareAt = money(specs.shopifyCompareAt * VAT);
      specsTouched = true;
    }
    if (specsTouched) $set.specs = specs;

    if ((p.variants || []).length) {
      before.variants = p.variants.map((v) => ({
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
      }));
      $set.variants = p.variants.map((v) => ({
        ...v,
        price: incVat(handle, Number(v.price) || 0),
        compareAtPrice:
          Number(v.compareAtPrice) > 0 ? money(v.compareAtPrice * VAT) : v.compareAtPrice ?? null,
      }));
    }

    for (const field of ["bases", "shades", "pendants", "wallFittings"]) {
      const list = p[field] || [];
      if (!list.length) continue;
      let touched = false;
      const next = list.map((c) => {
        const cur = Number(c?.price) || 0;
        const val = incVat(c?.handle, cur);
        if (val > 0 && Math.abs(val - cur) >= 0.005) {
          touched = true;
          componentsChanged++;
          return { ...c, price: val };
        }
        return c;
      });
      if (touched) {
        before[field] = list.map((c) => ({ handle: c?.handle, price: c?.price }));
        $set[field] = next;
      }
    }

    if (Object.keys($set).length) {
      updates.push({ _id: p._id, $set });
      rollback.push(before);
    }
  }

  console.log(
    `\nProducts to update: ${updates.length}  |  component prices changed: ${componentsChanged}`,
  );
  const sample = updates.slice(0, 5);
  for (const u of sample) {
    const p = products.find((x) => String(x._id) === String(u._id));
    console.log(
      `  ${p.name.slice(0, 44).padEnd(44)} £${p.price} → £${u.$set.price ?? p.price}` +
        (u.$set.specs?.compareAtPrice
          ? `  was £${p.specs.compareAtPrice} → £${u.$set.specs.compareAtPrice}`
          : ""),
    );
  }

  if (DRY_RUN) {
    console.log("\n[dry run] nothing written");
    return;
  }

  fs.writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 1));
  console.log(`rollback written: ${ROLLBACK}`);

  await connectMongo(process.env.MONGODB_URI);
  const P = mongoose.connection.db.collection("products");
  let done = 0;
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    await P.bulkWrite(
      chunk.map((u) => ({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { ...u.$set, updatedAt: new Date() } },
        },
      })),
      { ordered: false },
    );
    done += chunk.length;
    console.log(`  written ${done}/${updates.length}`);
  }
  await mongoose.disconnect();
  console.log(`Done. ${done} products updated.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
