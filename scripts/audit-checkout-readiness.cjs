/**
 * Can every product the storefront displays actually be checked out?
 *
 * READ-ONLY. Nothing is written to Mongo or Shopify.
 *
 * Checkout (src/app/api/checkout/shopify/route.ts) builds a Shopify draft
 * order, and every line has to resolve — from Mongo — to a live
 * `gid://shopify/ProductVariant/...`. This replays that resolution for every
 * line the product page can put in the basket, then asks Shopify about every
 * GID it lands on.
 *
 * Scope: products the storefront lists (category set, priced, photographed,
 * brand not hidden) in BOTH clusters — the older audits read only the primary.
 *
 * Lines simulated per product, mirroring ProductSection.tsx:
 *   plain     no option chosen       → product GID, or the default row when
 *                                       the product has several variants
 *   option    one per variant row    → key `sku || "opt1 / opt2 / opt3"`,
 *                                       matched by sku or name like the route
 *   colour    swatch with a SAP code → configured line on the product GID
 *   skylight  pitch × add-on         → row named "<pitch> / <add-on>"
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-checkout-readiness.cjs
 *   OUT=<dir>   where the JSON report is written (default: scratch/)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const OUT_DIR = process.env.OUT || path.join(__dirname, "..", "scratch");
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

/* ---------- copied verbatim from the checkout route (do not drift) ---------- */

function defaultVariantRow(product) {
  const rows = product.variants ?? [];
  const gid = String(product.shopifyVariantId || "");
  return (
    (gid ? rows.find((v) => String(v.shopifyVariantId || "") === gid) : null) ||
    rows.find((v) => v.isDefault) ||
    rows[0] ||
    null
  );
}

function resolveChosenVariant(product, suffix, sentGid = "") {
  const variants = product.variants ?? [];
  if (suffix.startsWith("pitch::")) return { required: false };
  if (!suffix) {
    if (variants.length > 1) {
      const fallback = defaultVariantRow(product);
      return {
        required: true,
        shopifyVariantId: fallback?.shopifyVariantId ? String(fallback.shopifyVariantId) : undefined,
        row: fallback,
      };
    }
    return { required: false };
  }
  const matches = variants.filter(
    (v) =>
      (v.sku && String(v.sku).trim() === suffix) ||
      (v.name && String(v.name).trim() === suffix),
  );
  const match =
    (matches.length > 1 && sentGid
      ? matches.find((v) => String(v.shopifyVariantId || "") === sentGid)
      : undefined) ?? matches[0];
  return {
    required: true,
    shopifyVariantId: match?.shopifyVariantId ? String(match.shopifyVariantId) : undefined,
    row: match,
    ...(match ? {} : { unknownOption: suffix }),
  };
}

function resolveSkylight(product, pitch, addons) {
  const rows = product.variants ?? [];
  const byName = (name) =>
    rows.find((v) => String(v.name || "").trim().toLowerCase() === name.trim().toLowerCase());
  const base = byName(`${pitch} / None`) || defaultVariantRow(product);
  const exact = addons.length === 1 ? byName(`${pitch} / ${addons[0]}`) : null;
  const row = exact ?? base;
  return { shopifyVariantId: row?.shopifyVariantId ? String(row.shopifyVariantId) : undefined, row };
}

/* ---------- product page helpers (ProductSection.tsx / ProductVariantPicker.tsx) ---------- */

function optionAt(v, pos) {
  return String((pos === 1 ? v.option1 : pos === 2 ? v.option2 : v.option3) || "").trim();
}

function pickerAxes(product, brandSlug, brandName) {
  const ownsOptionAxes =
    brandSlug === "the-under-floor-heating" || /under.?floor.?heating/i.test(String(brandName || ""));
  if (ownsOptionAxes) return [];
  return (product.shopifyOptions || []).filter(
    (a) => a?.name && !/^title$/i.test(String(a.name)) && (a.values || []).length > 0,
  );
}

/* ---------- main ---------- */

async function connectBoth() {
  const mongoose = require("mongoose");
  const { connectMongo, applyDns } = require("./mongo-connect.cjs");
  const primary = await connectMongo(process.env.MONGODB_URI);
  let secondary = null;
  if (process.env.MONGODB_URL2) {
    applyDns();
    secondary = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
      .asPromise();
  }
  return { primary, secondary };
}

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
  const { storefrontVisibilityClause } = require("../src/lib/pricedOnly.ts");
  const { HIDDEN_BRAND_SLUGS } = require("../src/lib/hiddenBrands.ts");

  const { primary, secondary } = await connectBoth();

  // Brands always live in the primary.
  const brands = await primary.db.collection("brands").find({}).project({ name: 1, slug: 1, isActive: 1 }).toArray();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  const hiddenBrandIds = brands
    .filter((b) => b.isActive === false || HIDDEN_BRAND_SLUGS.includes(String(b.slug || "").toLowerCase()))
    .map((b) => b._id);

  const visible = {
    $and: [
      { category: { $exists: true, $nin: [null, ""] } },
      storefrontVisibilityClause(),
      ...(hiddenBrandIds.length ? [{ brand: { $nin: hiddenBrandIds } }] : []),
    ],
  };
  const projection = {
    name: 1, brand: 1, price: 1, stock: 1, department: 1, category: 1,
    shopifyProductId: 1, shopifyVariantId: 1, shopifyHandle: 1,
    variants: 1, shopifyOptions: 1, colorOptions: 1, finishes: 1, flashings: 1,
  };

  const products = [];
  for (const [cluster, conn] of [["primary", primary], ["secondary", secondary]]) {
    if (!conn) continue;
    // Read-only; a dropped Atlas connection mid-scan is simply retried.
    let rows;
    for (let attempt = 1; ; attempt++) {
      try {
        rows = await conn.db.collection("products").find(visible).project(projection).toArray();
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`${cluster}: scan interrupted (${e.name}), retrying ${attempt}/3…`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
    for (const r of rows) products.push({ ...r, _cluster: cluster });
    console.log(`${cluster}: ${rows.length} storefront-visible products`);
  }

  /*
   * Pass 1 — simulate every line in Mongo, collecting the GIDs each lands on.
   * A line is { product, kind, key, gid, row, problem }.
   */
  const lines = [];
  const issues = [];
  const addIssue = (p, kind, key, code, detail) =>
    issues.push({
      cluster: p._cluster,
      brand: brandById.get(String(p.brand))?.name || "?",
      productId: String(p._id),
      name: p.name,
      lineKind: kind,
      lineKey: key,
      code,
      detail,
    });

  // Variant GIDs claimed by more than one product (catalogue-wide).
  const gidOwners = new Map();
  for (const p of products) {
    for (const v of p.variants || []) {
      const g = String(v.shopifyVariantId || "");
      if (!g) continue;
      if (!gidOwners.has(g)) gidOwners.set(g, new Set());
      gidOwners.get(g).add(String(p._id));
    }
  }

  for (const p of products) {
    const brand = brandById.get(String(p.brand));
    const variants = p.variants || [];

    // Structural facts.
    if (p.shopifyProductId && !PRODUCT_GID.test(String(p.shopifyProductId)))
      addIssue(p, "product", "", "BAD_PRODUCT_GID", String(p.shopifyProductId));
    const seenGid = new Map();
    const seenSku = new Map();
    for (const v of variants) {
      const g = String(v.shopifyVariantId || "");
      if (g) {
        if (seenGid.has(g))
          addIssue(p, "option", v.sku || v.name, "SHARED_GID_IN_PRODUCT", `"${v.name}" and "${seenGid.get(g)}" share ${g}`);
        seenGid.set(g, v.name);
        if ((gidOwners.get(g)?.size || 0) > 1)
          addIssue(p, "option", v.sku || v.name, "GID_CLAIMED_BY_OTHER_PRODUCT", `${g} also on ${[...gidOwners.get(g)].filter((id) => id !== String(p._id)).join(", ")}`);
      }
      const s = String(v.sku || "").trim();
      if (s) {
        if (seenSku.has(s))
          addIssue(p, "option", s, "DUPLICATE_SKU_IN_PRODUCT", `"${v.name}" unreachable — checkout picks "${seenSku.get(s)}"`);
        else seenSku.set(s, v.name);
      }
    }

    // plain line — what the cart sends with no option chosen
    {
      const r = resolveChosenVariant(p, "");
      if (r.required) {
        lines.push({ p, kind: "plain(default row)", key: "", gid: r.shopifyVariantId, row: r.row });
        if (!r.shopifyVariantId)
          addIssue(p, "plain(default row)", "", "DEFAULT_ROW_NO_GID", `default row "${r.row?.name}" has no Shopify variant`);
      } else {
        lines.push({ p, kind: "plain", key: "", gid: p.shopifyVariantId || undefined, row: variants[0] || null, plain: true });
        if (!p.shopifyVariantId)
          addIssue(p, "plain", "", "PRODUCT_NO_VARIANT_GID", "no shopifyVariantId — checkout would create a new Shopify product");
      }
    }

    // option lines — one per variant the picker can select
    const axes = pickerAxes(p, brand?.slug, brand?.name);
    if (axes.length > 0 && variants.length > 1) {
      for (const v of variants) {
        const label = axes
          .map((axis, i) => optionAt(v, Number(axis.position) || i + 1))
          .filter(Boolean)
          .join(" / ");
        if (!label) continue; // the picker cannot land on this row
        const key = v.sku || label;
        // The cart line carries the picked row's GID (ProductSection.tsx).
        const r = resolveChosenVariant(p, key, String(v.shopifyVariantId || ""));
        if (r.unknownOption) {
          addIssue(p, "option", key, "OPTION_KEY_UNMATCHED", `picker sends "${key}" but no row has that sku/name`);
          continue;
        }
        if (r.row !== v)
          addIssue(p, "option", key, "OPTION_RESOLVES_TO_OTHER_ROW", `chose "${v.name}" but checkout resolves "${r.row?.name}"`);
        lines.push({ p, kind: "option", key, gid: r.shopifyVariantId, row: r.row });
        if (!r.shopifyVariantId)
          addIssue(p, "option", key, "OPTION_NO_GID", `"${r.row?.name}" has no Shopify variant`);
      }
    }

    // colour swatches — configured line on the product's own variant
    if ((p.colorOptions || []).some((c) => c?.sap) && p.shopifyVariantId) {
      lines.push({ p, kind: "colour", key: "", gid: p.shopifyVariantId, row: null, priceUnchecked: true });
    }

    // skylights — pitch × add-on rows
    if (brand?.slug === "cambridge-skylights" && p.department === "rooflights-and-glass") {
      const pitches = (p.finishes || []).map((f) => f?.name).filter(Boolean);
      const addons = (p.flashings || []).map((f) => f?.name).filter(Boolean);
      // With no pitch or add-on to pick, the page sends a plain line instead.
      if (!pitches.length && !addons.length) continue;
      for (const pitch of pitches.length ? pitches : [""]) {
        for (const combo of [[], ...addons.map((a) => [a])]) {
          const r = resolveSkylight(p, pitch, combo);
          const key = `pitch::${pitch}::addons::${combo.join(",")}`;
          lines.push({ p, kind: "skylight", key, gid: r.shopifyVariantId, row: r.row, priceUnchecked: true });
          if (!r.shopifyVariantId) addIssue(p, "skylight", key, "SKYLIGHT_NO_GID", `row "${r.row?.name}" has no Shopify variant`);
        }
      }
    }
  }

  /*
   * Pass 2 — ask Shopify about every distinct GID (variants and products).
   */
  const variantGids = [...new Set(lines.map((l) => l.gid).filter(Boolean))];
  const badFormat = variantGids.filter((g) => !VARIANT_GID.test(g));
  const liveVariants = new Map();
  const goodGids = variantGids.filter((g) => VARIANT_GID.test(g));
  console.log(`checking ${goodGids.length} variant GIDs on Shopify…`);
  for (let i = 0; i < goodGids.length; i += 100) {
    const chunk = goodGids.slice(i, i + 100);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant {
         id price sku inventoryPolicy inventoryQuantity
         inventoryItem { tracked }
         product { id status }
       } } }`,
      { ids: chunk },
    );
    for (const n of d.nodes || []) if (n?.id) liveVariants.set(n.id, n);
    if ((i / 100) % 20 === 0) process.stdout.write(`  ${Math.min(i + 100, goodGids.length)}/${goodGids.length}\n`);
  }

  // For dead variant GIDs: is the product itself still there (re-mappable)?
  const productGids = [...new Set(products.map((p) => p.shopifyProductId).filter((g) => g && PRODUCT_GID.test(g)))];
  const liveProducts = new Map();
  console.log(`checking ${productGids.length} product GIDs on Shopify…`);
  for (let i = 0; i < productGids.length; i += 250) {
    const chunk = productGids.slice(i, i + 250);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id status } } }`,
      { ids: chunk },
    );
    for (const n of d.nodes || []) if (n?.id) liveProducts.set(n.id, n);
  }

  const reported = new Set();
  const once = (p, kind, key, code, detail) => {
    const k = `${p._id}|${key}|${code}`;
    if (reported.has(k)) return;
    reported.add(k);
    addIssue(p, kind, key, code, detail);
  };

  for (const l of lines) {
    if (!l.gid) continue;
    const p = l.p;
    if (!VARIANT_GID.test(l.gid)) {
      once(p, l.kind, l.key, "BAD_VARIANT_GID", l.gid);
      continue;
    }
    const v = liveVariants.get(l.gid);
    if (!v) {
      const prodAlive = p.shopifyProductId && liveProducts.has(p.shopifyProductId);
      once(p, l.kind, l.key, prodAlive ? "VARIANT_DEAD_PRODUCT_LIVE" : "VARIANT_AND_PRODUCT_DEAD", l.gid);
      continue;
    }
    if (p.shopifyProductId && v.product?.id !== p.shopifyProductId)
      once(p, l.kind, l.key, "VARIANT_UNDER_OTHER_PRODUCT", `${l.gid} belongs to ${v.product?.id}, product stores ${p.shopifyProductId}`);
    if (v.product?.status !== "ACTIVE")
      once(p, l.kind, l.key, `SHOPIFY_PRODUCT_${v.product?.status}`, v.product?.id);
    if (!l.priceUnchecked) {
      const mongoPrice = Number(l.row?.price) || Number(p.price) || 0;
      const shopPrice = Number(v.price) || 0;
      if (shopPrice <= 0) once(p, l.kind, l.key, "SHOPIFY_PRICE_ZERO", `site £${mongoPrice}`);
      else if (Math.abs(shopPrice - mongoPrice) > 0.01)
        once(p, l.kind, l.key, "PRICE_MISMATCH", `site £${mongoPrice.toFixed(2)} · Shopify £${shopPrice.toFixed(2)}`);
    }
    if (v.inventoryItem?.tracked && v.inventoryPolicy === "DENY" && Number(v.inventoryQuantity) <= 0)
      once(p, l.kind, l.key, "SHOPIFY_OUT_OF_STOCK_DENY", `qty ${v.inventoryQuantity}, site stock ${l.row?.stock ?? p.stock}`);
  }
  for (const g of badFormat) {
    const l = lines.find((x) => x.gid === g);
    once(l.p, l.kind, l.key, "BAD_VARIANT_GID", g);
  }

  /* ---------- report ---------- */
  const failingProducts = new Set(issues.map((i) => i.productId));
  const byCode = {};
  const byBrand = {};
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] || 0) + 1;
    byBrand[i.brand] = byBrand[i.brand] || new Set();
    byBrand[i.brand].add(i.productId);
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    visibleProducts: products.length,
    byCluster: {
      primary: products.filter((p) => p._cluster === "primary").length,
      secondary: products.filter((p) => p._cluster === "secondary").length,
    },
    linesSimulated: lines.length,
    variantGidsChecked: goodGids.length,
    productsWithIssues: failingProducts.size,
    productsClean: products.length - failingProducts.size,
    issuesByCode: Object.fromEntries(Object.entries(byCode).sort((a, b) => b[1] - a[1])),
    productsWithIssuesByBrand: Object.fromEntries(
      Object.entries(byBrand).map(([b, s]) => [b, s.size]).sort((a, b) => b[1] - a[1]),
    ),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const out = path.join(OUT_DIR, `checkout-audit-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ summary, issues }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nreport: ${out}`);

  await primary.close();
  if (secondary) await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
