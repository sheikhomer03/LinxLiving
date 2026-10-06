/**
 * Make each Shopify variant price equal the price the storefront shows.
 *
 * Checkout charges the Shopify variant price, so wherever the two differ the
 * customer pays something other than what the product page quoted. The site
 * price is the source of truth (VAT-inclusive, see lib/vat.ts).
 *
 * The displayed price is computed exactly as ProductSection.tsx does it:
 *   activePrice = variant.price > 0 ? variant.price : product.price
 *   variant compare-at above activePrice → shown as activePrice
 *   else                                → productSale(...).now(activePrice)
 * where the sale is a compare-at (specs.shopifyCompareAt / compareAtPrice,
 * ignored for salePriceMode "raise-then-percent") or specs.salePercent.
 *
 * Only the `price` of variants is changed — nothing is created or deleted.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-shopify-prices-to-ui.cjs            # dry run (default)
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/fix-shopify-prices-to-ui.cjs    # write, with rollback file
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";
const OUT_DIR = path.join(__dirname, "..", "scratch");
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const round2 = (n) => Math.round(n * 100) / 100;

function pickSpec(specs, key) {
  if (!specs) return undefined;
  const direct = specs[key];
  if (direct != null && String(direct).trim()) return String(direct);
  const lower = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
  if (lower?.[1] != null && String(lower[1]).trim()) return String(lower[1]);
  return undefined;
}

/** productSale().nowRatio for a product, as the product page derives it. */
function nowRatio(p) {
  const specs = p.specs || {};
  let compareAt = null;
  if (String(pickSpec(specs, "salePriceMode") || "") !== "raise-then-percent") {
    const raw = pickSpec(specs, "shopifyCompareAt") || pickSpec(specs, "compareAtPrice");
    const n = Number(raw);
    if (raw != null && raw !== "" && Number.isFinite(n) && n > 0) compareAt = n;
  }
  const saleRaw = pickSpec(specs, "salePercent");
  const percent = saleRaw != null && !Number.isNaN(Number(saleRaw)) ? Number(saleRaw) : NaN;
  const base = Number(p.price);
  if (Number.isFinite(base) && base > 0 && compareAt != null && compareAt > base) return 1;
  if (Number.isFinite(percent) && percent > 0 && percent < 100) return 1 - percent / 100;
  return 1;
}

function displayed(p, row) {
  const active = Number(row?.price) > 0 ? Number(row.price) : Number(p.price);
  const vCompare = Number(row?.compareAtPrice);
  if (row && Number.isFinite(vCompare) && vCompare > active) return round2(active);
  return round2(active * nowRatio(p));
}

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
  const { storefrontVisibilityClause } = require("../src/lib/pricedOnly.ts");
  const { HIDDEN_BRAND_SLUGS } = require("../src/lib/hiddenBrands.ts");
  const { connectMongo, applyDns } = require("./mongo-connect.cjs");

  const primary = await connectMongo(process.env.MONGODB_URI);
  applyDns();
  const secondary = process.env.MONGODB_URL2
    ? await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise()
    : null;

  const brands = await primary.db.collection("brands").find({}).project({ name: 1, slug: 1, isActive: 1 }).toArray();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));
  const hidden = brands
    .filter((b) => b.isActive === false || HIDDEN_BRAND_SLUGS.includes(String(b.slug || "").toLowerCase()))
    .map((b) => b._id);
  const visible = {
    $and: [
      { category: { $exists: true, $nin: [null, ""] } },
      storefrontVisibilityClause(),
      ...(hidden.length ? [{ brand: { $nin: hidden } }] : []),
    ],
  };
  const projection = { name: 1, brand: 1, price: 1, specs: 1, shopifyVariantId: 1, variants: 1 };

  // Target price per variant GID. A GID two rows disagree about is not touched.
  const targets = new Map(); // gid -> { price, product, label }
  const conflicts = new Map();
  const want = (gid, price, p, label) => {
    if (!gid || !VARIANT_GID.test(gid) || !(price > 0)) return;
    const cur = targets.get(gid);
    if (cur && Math.abs(cur.price - price) > 0.005) {
      conflicts.set(gid, [cur, { price, product: p, label }]);
      return;
    }
    if (!cur) targets.set(gid, { price, product: p, label });
  };

  for (const [cluster, conn] of [["primary", primary], ["secondary", secondary]]) {
    if (!conn) continue;
    // A long scan over Atlas can lose its connection mid-way; it is read-only
    // and `want` is idempotent, so a dropped scan is simply run again.
    let n = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        n = 0;
        const cursor = conn.db.collection("products").find(visible).project(projection);
        for await (const p of cursor) {
          n++;
          p._cluster = cluster;
          const rows = p.variants || [];
          for (const v of rows) want(String(v.shopifyVariantId || ""), displayed(p, v), p, v.name || v.sku || "");
          // Product-level GID with no row of its own: sold at the product price.
          const pg = String(p.shopifyVariantId || "");
          if (pg && !rows.some((v) => String(v.shopifyVariantId || "") === pg)) want(pg, displayed(p, null), p, "(product)");
        }
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`${cluster}: scan interrupted (${e.name}), retrying ${attempt}/3…`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
    console.log(`${cluster}: ${n} visible products scanned`);
  }
  for (const g of conflicts.keys()) targets.delete(g);

  // Current Shopify prices.
  const gids = [...targets.keys()];
  console.log(`reading ${gids.length} Shopify variant prices…`);
  const current = new Map();
  for (let i = 0; i < gids.length; i += 100) {
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price compareAtPrice product { id } } } }`,
      { ids: gids.slice(i, i + 100) },
    );
    for (const node of d.nodes || []) if (node?.id) current.set(node.id, node);
    if ((i / 100) % 50 === 0) console.log(`  ${Math.min(i + 100, gids.length)}/${gids.length}`);
  }

  const changes = [];
  for (const [gid, t] of targets) {
    const cur = current.get(gid);
    if (!cur) continue; // dead GID — handled by the linking fix, not here
    const shop = Number(cur.price);
    if (Math.abs(shop - t.price) <= 0.005) continue;
    changes.push({
      variantId: gid,
      productId: cur.product.id,
      from: shop,
      to: t.price,
      compareAtPrice: cur.compareAtPrice,
      brand: brandName.get(String(t.product.brand)) || "?",
      mongoId: String(t.product._id),
      cluster: t.product._cluster,
      name: t.product.name,
      option: t.label,
    });
  }

  const byBrand = {};
  for (const c of changes) byBrand[c.brand] = (byBrand[c.brand] || 0) + 1;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const planFile = path.join(OUT_DIR, `shopify-price-plan-${stamp}.json`);
  fs.writeFileSync(
    planFile,
    JSON.stringify(
      {
        conflicts: [...conflicts].map(([g, [a, b]]) => ({
          gid: g,
          a: { price: a.price, id: String(a.product._id), name: a.product.name, label: a.label },
          b: { price: b.price, id: String(b.product._id), name: b.product.name, label: b.label },
        })),
        changes,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        variantsCompared: current.size,
        pricesToChange: changes.length,
        productsAffected: new Set(changes.map((c) => c.productId)).size,
        skippedConflictingGids: conflicts.size,
        byBrand: Object.fromEntries(Object.entries(byBrand).sort((a, b) => b[1] - a[1])),
        sample: changes.slice(0, 8).map((c) => `${c.brand} | ${c.name} | ${c.option} | £${c.from} → £${c.to}`),
      },
      null,
      2,
    ),
  );
  console.log(`plan: ${planFile}`);

  if (APPLY && changes.length) {
    // Rollback first: every variant's price as it stands now.
    const rollback = path.join(path.join(__dirname, ".."), `rollback-shopify-prices-to-ui-${stamp}.json`);
    fs.writeFileSync(rollback, JSON.stringify(changes.map((c) => ({ productId: c.productId, variantId: c.variantId, price: c.from })), null, 2));
    console.log(`rollback: ${rollback}`);

    const byProduct = new Map();
    for (const c of changes) {
      if (!byProduct.has(c.productId)) byProduct.set(c.productId, []);
      byProduct.get(c.productId).push(c);
    }
    let ok = 0;
    const failed = [];
    for (const [productId, list] of byProduct) {
      try {
        const d = await shopifyAdminRequest(
          `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
             productVariantsBulkUpdate(productId: $productId, variants: $variants) {
               productVariants { id price }
               userErrors { field message }
             } }`,
          { productId, variants: list.map((c) => ({ id: c.variantId, price: c.to.toFixed(2) })) },
        );
        const r = d.productVariantsBulkUpdate;
        if (r.userErrors?.length) failed.push({ productId, errors: r.userErrors });
        else ok += list.length;
      } catch (e) {
        failed.push({ productId, errors: [String(e.message || e)] });
      }
    }
    console.log(`applied: ${ok} variant prices · failed products: ${failed.length}`);
    if (failed.length) {
      const ff = path.join(OUT_DIR, `shopify-price-failures-${stamp}.json`);
      fs.writeFileSync(ff, JSON.stringify(failed, null, 2));
      console.log(`failures: ${ff}`);
    }
  }

  await primary.close();
  if (secondary) await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
