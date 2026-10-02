/**
 * Make Tap Warehouse variants visible and buyable.
 *
 * 768 Tap Warehouse products carry 2+ variant rows, but with empty `options`,
 * `option1` holding the whole variant name, no `shopifyOptions`, and no
 * Shopify variants (each product is a single "Default Title" variant). The
 * picker needs shopifyOptions + per-variant values, and the cart refuses a
 * picked variant with no shopifyVariantId — so both sides are needed.
 *
 * Option values are not guessed: these variants come from drench.co.uk (the
 * same group), and the matching Drench product holds exact option values for
 * each SKU. A product is done only when EVERY variant matches and the option
 * combinations are unique; otherwise it is skipped and listed.
 *
 * Shopify: productVariantsBulkCreate (REMOVE_STANDALONE_VARIANT) adds the real
 * variants with the existing variant's settings (price, taxable, not tracked,
 * requires shipping, policy) and each variant's own image; the product's
 * title, description, media, status and stock are not sent and are checked
 * unchanged afterwards. The full site sync is deliberately NOT used: it would
 * also push stock (DB 1000 vs Shopify 0) and overwrite descriptions.
 *
 * DB: only shopifyOptions, variants[].options/option1-3/shopifyVariantId/
 * shopifyInventoryItemId and the product-level shopifyVariantId change.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/tapwarehouse-create-variants.cjs [--write] [--limit=5] [--only=<id>]
 */
const path = require("path");
const fs = require("fs");
const util = require("util");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}
const { EJSON } = mongoose.mongo.BSON;
const arg = (n, d = "") => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=") || d;
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const ONLY = arg("only");
const TW = "6aad6ac07120f8ddd7388bef";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "tapwarehouse-variants");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");

let token;
async function gql(query, variables) {
  const isMutation = /^\s*mutation/.test(query);
  for (let a = 0; a < 5; a++) {
    let answered = false;
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(120_000) });
      const b = await r.json();
      answered = true;
      if (!b.errors) return b.data;
      if (!JSON.stringify(b.errors).includes("THROTTLED")) throw new Error(JSON.stringify(b.errors).slice(0, 300));
    } catch (e) {
      if (isMutation && !answered) throw e; // never repeat a mutation that may have run
      if (answered && !String(e.message).includes("THROTTLED")) throw e;
    }
    await sleep(2000 * (a + 1));
  }
  throw new Error("Shopify request failed");
}

const PRODUCT_Q = `query($id: ID!) { product(id: $id) {
  id title status descriptionHtml handle vendor productType tags
  mediaCount { count } media(first: 250) { nodes { id ... on MediaImage { image { url } } } }
  options { name values }
  variants(first: 100) { nodes { id sku price compareAtPrice taxable inventoryPolicy selectedOptions { name value }
    inventoryItem { id tracked requiresShipping } } } } }`;

/** Exact option values for each SKU, from the matching Drench product. */
function planFor(p, drenchBySku) {
  const rows = [];
  let source = null;
  for (const v of p.variants) {
    const hit = drenchBySku.get(clean(v.sku));
    if (!hit || !Object.keys(hit.v.options || {}).length) return { skip: "a variant has no exact option match" };
    if (source && String(hit.p._id) !== String(source._id)) return { skip: "variants match different Drench products" };
    source = hit.p;
    rows.push({ v, opts: hit.v.options });
  }
  const axes = (source.shopifyOptions || []).filter((a) => a?.name).sort((a, b) => (+a.position || 0) - (+b.position || 0));
  if (!axes.length) return { skip: "Drench product has no option list" };
  // Values per axis, in Drench's order, limited to what these variants use.
  const used = axes.map((a) => (a.values || []).filter((val) => rows.some((r) => r.opts[a.name] === val)));
  const keepAxes = axes.map((a, i) => ({ name: a.name, values: used[i] })).filter((a) => a.values.length);
  for (const r of rows) for (const a of keepAxes) if (!r.opts[a.name]) return { skip: `a variant lacks a value for "${a.name}"` };
  const combos = rows.map((r) => keepAxes.map((a) => r.opts[a.name]).join(" / "));
  if (new Set(combos).size !== combos.length) return { skip: "two variants share the same option values" };
  if (keepAxes.length > 3) return { skip: "more than 3 option axes" };
  return { axes: keepAxes.map((a, i) => ({ name: a.name, values: a.values, position: i + 1 })), rows };
}

/**
 * Exact variant labels from the product's own Tap Warehouse page: its analytics
 * item list names every variant by SKU ("item_id") with its label
 * ("item_variant"), under the page's "Select an option" selector.
 */
async function labelsFromPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`page answered ${res.status}`);
  const html = await res.text();
  const out = new Map();
  for (const m of html.matchAll(/"item_id":"([^"]+)"[^{}]*?"item_variant":"([^"]*)"/g)) {
    const sku = m[1].trim();
    const label = JSON.parse(`"${m[2]}"`).trim();
    if (!out.has(sku)) out.set(sku, label);
  }
  return out;
}
function planFromLabels(p, labels) {
  const axis = "Select an option";
  const rows = [];
  for (const v of p.variants) {
    const label = labels.get(clean(v.sku));
    if (!label) return { skip: "page has no label for a variant" };
    rows.push({ v, opts: { [axis]: label } });
  }
  const values = [...new Set(rows.map((r) => r.opts[axis]))];
  if (values.length !== rows.length) return { skip: "two variants share the same label on the page" };
  return { axes: [{ name: axis, values, position: 1 }], rows };
}

(async () => {
  token = (await (await fetch(`https://${DOMAIN}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }) })).json()).access_token;
  fs.mkdirSync(DIR, { recursive: true });
  const conn = await connectMongo(process.env.MONGODB_URL2);
  const col = conn.db.collection("products");
  const tw = new mongoose.Types.ObjectId(TW);

  const filter = { brand: tw, "variants.1": { $exists: true }, shopifyProductId: { $nin: [null, ""] }, "shopifyOptions.0": { $exists: false } };
  if (ONLY) filter._id = new mongoose.Types.ObjectId(ONLY);
  const docs = await col.find(filter).sort({ _id: 1 }).toArray();
  const skus = [...new Set(docs.flatMap((d) => d.variants.map((v) => clean(v.sku))))];
  const drenchBySku = new Map();
  for (const o of await col.find({ brand: { $ne: tw }, "variants.sku": { $in: skus } }).project({ shopifyOptions: 1, variants: 1, name: 1 }).toArray()) {
    for (const v of o.variants || []) if (skus.includes(clean(v.sku)) && !drenchBySku.has(clean(v.sku))) drenchBySku.set(clean(v.sku), { p: o, v });
  }

  const plans = [];
  const skipped = new Map();
  const FROM_PAGE = process.argv.includes("--from-page");
  for (const d of docs) {
    let pl = planFor(d, drenchBySku);
    if (pl.skip && FROM_PAGE && /tapwarehouse\.com\/p\//.test(String(d.sourceUrl || ""))) {
      try {
        pl = planFromLabels(d, await labelsFromPage(d.sourceUrl));
      } catch (e) {
        pl = { skip: `page: ${String(e.message).slice(0, 60)}` };
      }
      await sleep(400);
    }
    if (pl.skip) {
      skipped.set(pl.skip, (skipped.get(pl.skip) || []).concat(String(d._id)));
      continue;
    }
    plans.push({ d, ...pl });
  }
  const todo = plans.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${docs.length} products without options; ready ${plans.length}; doing ${todo.length}`);
  for (const [why, ids] of skipped) say(`  skipped ${ids.length}: ${why}`);
  fs.writeFileSync(path.join(DIR, "skipped.json"), JSON.stringify(Object.fromEntries(skipped), null, 1));
  if (!WRITE) {
    for (const pl of todo.slice(0, 3)) say(`  e.g. ${pl.d.name.slice(0, 50)} → ${pl.axes.map((a) => `${a.name}: ${a.values.join(", ")}`).join(" | ")}`);
    await mongoose.disconnect();
    return;
  }

  const backupFile = path.join(DIR, `backup-${STAMP}.ejson.jsonl`);
  const t = { done: 0, failed: 0, verifiedShopify: 0, verifiedDb: 0, problems: [] };
  for (const { d, axes, rows } of todo) {
    try {
      const before = (await gql(PRODUCT_Q, { id: d.shopifyProductId })).product;
      if (!before) throw new Error("product not in Shopify");
      if (before.variants.nodes.length !== 1 || before.options[0]?.name !== "Title") throw new Error("Shopify product already has real variants");
      const base = before.variants.nodes[0];
      const mediaByUrl = new Map(before.media.nodes.filter((m) => m.image?.url).map((m) => [m.image.url.split("?")[0], m.id]));

      fs.appendFileSync(backupFile, `${EJSON.stringify({ db: d, shopify: before }, { relaxed: false })}\n`);
      const variantsInput = rows.map(({ v, opts }) => {
        const media = mediaByUrl.get(clean(v.imageUrl).split("?")[0]);
        return {
          optionValues: axes.map((a) => ({ optionName: a.name, name: opts[a.name] })),
          price: String(v.price ?? base.price),
          compareAtPrice: base.compareAtPrice,
          taxable: base.taxable,
          inventoryPolicy: base.inventoryPolicy,
          inventoryItem: { sku: clean(v.sku), tracked: base.inventoryItem.tracked, requiresShipping: base.inventoryItem.requiresShipping },
          ...(media ? { mediaId: media } : {}),
        };
      });
      // 1. Create the option(s); the existing variant takes each axis's first value.
      const opt = await gql(
        `mutation($pid: ID!, $o: [OptionCreateInput!]!) {
          productOptionsCreate(productId: $pid, options: $o, variantStrategy: LEAVE_AS_IS) { userErrors { field message } } }`,
        { pid: d.shopifyProductId, o: axes.map((a) => ({ name: a.name, values: a.values.map((name) => ({ name })) })) },
      );
      if (opt.productOptionsCreate.userErrors?.length) throw new Error("options: " + opt.productOptionsCreate.userErrors.map((e) => e.message).join("; "));
      // 2. The existing variant becomes the first row (keeps its Shopify id).
      const [first, ...others] = variantsInput;
      const upd = await gql(
        `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $pid, variants: $v) { productVariants { id sku inventoryItem { id } } userErrors { field message } } }`,
        { pid: d.shopifyProductId, v: [{ id: base.id, ...first }] },
      );
      if (upd.productVariantsBulkUpdate.userErrors?.length) throw new Error("update first: " + upd.productVariantsBulkUpdate.userErrors.map((e) => e.message).join("; "));
      // 3. Add the remaining rows.
      let created = [];
      if (others.length) {
        const res = await gql(
          `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $pid, variants: $v) { productVariants { id sku inventoryItem { id } } userErrors { field message } } }`,
          { pid: d.shopifyProductId, v: others },
        );
        if (res.productVariantsBulkCreate.userErrors?.length) throw new Error("create others: " + res.productVariantsBulkCreate.userErrors.map((e) => e.message).join("; "));
        created = res.productVariantsBulkCreate.productVariants;
      }
      const bySku = new Map([...upd.productVariantsBulkUpdate.productVariants, ...created].map((x) => [clean(x.sku), x]));

      // Verify Shopify: only the variants changed.
      const after = (await gql(PRODUCT_Q, { id: d.shopifyProductId })).product;
      const sameProduct =
        after.title === before.title && after.status === before.status && after.descriptionHtml === before.descriptionHtml &&
        after.handle === before.handle && after.vendor === before.vendor && after.productType === before.productType &&
        JSON.stringify(after.tags) === JSON.stringify(before.tags) && after.mediaCount.count === before.mediaCount.count;
      const variantsOk =
        after.variants.nodes.length === rows.length &&
        rows.every(({ v, opts }) => {
          const n = after.variants.nodes.find((x) => clean(x.sku) === clean(v.sku));
          return n && Number(n.price) === Number(v.price) && n.inventoryItem.tracked === base.inventoryItem.tracked &&
            axes.every((a) => n.selectedOptions.some((s) => s.name === a.name && s.value === opts[a.name]));
        });
      if (sameProduct && variantsOk) t.verifiedShopify++;
      else t.problems.push(`${d._id} shopify sameProduct=${sameProduct} variantsOk=${variantsOk}`);

      // DB: option list, per-variant values and ids; product default variant id.
      const variants = d.variants.map((v) => {
        const row = rows.find((x) => x.v === v);
        const sv = bySku.get(clean(v.sku));
        const vals = axes.map((a) => row.opts[a.name]);
        return { ...v, options: Object.fromEntries(axes.map((a, i) => [a.name, vals[i]])), option1: vals[0] || "", option2: vals[1] || "", option3: vals[2] || "", shopifyVariantId: sv?.id || "", shopifyInventoryItemId: sv?.inventoryItem?.id || "" };
      });
      const lead = variants.find((v) => v.isDefault && v.shopifyVariantId) || variants.find((v) => v.shopifyVariantId);
      const set = { shopifyOptions: axes, variants, shopifyVariantId: lead.shopifyVariantId };
      const up = await col.updateOne({ _id: d._id, variants: d.variants }, { $set: set });
      const a = await col.findOne({ _id: d._id });
      const strip = (x) => {
        const y = JSON.parse(EJSON.stringify(x, { relaxed: false }));
        delete y.shopifyOptions;
        delete y.shopifyVariantId;
        y.variants = (y.variants || []).map((v) => {
          const { options, option1, option2, option3, shopifyVariantId, shopifyInventoryItemId, ...rest } = v;
          return rest;
        });
        return y;
      };
      const dbOk = up.modifiedCount === 1 && util.isDeepStrictEqual(strip(a), strip(d)) && a.variants.every((v) => v.shopifyVariantId && v.option1);
      if (dbOk) t.verifiedDb++;
      else t.problems.push(`${d._id} db`);
      t.done++;
      say(`  ✓ ${d.name.slice(0, 55)} — ${rows.length} variants (${axes.map((x) => x.name).join(", ")}) shopify:${sameProduct && variantsOk} db:${dbOk}`);
    } catch (e) {
      t.failed++;
      t.problems.push(`${d._id} ${String(e.message).slice(0, 200)}`);
      say(`  ✗ ${d.name.slice(0, 55)} — ${String(e.message).slice(0, 200)}`);
    }
  }
  say(JSON.stringify(t, null, 1));
  say(`backup: ${backupFile}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
