// Aica stock sync — Phase 1+2, READ-ONLY.
// DB2 + Shopify are only read. Live site: products.json pages + a 5-variant cart probe.
const path = require("path");
const fs = require("fs");
const dns = require("dns");
const root = process.argv[2];
const OUT = path.join(root, ".scratch/aica");
const { MongoClient, ObjectId } = require(path.join(root, "node_modules/mongodb"));

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));

const ORIGIN = "https://www.aicabathrooms.co.uk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GB = "localization=GB; cart_currency=GBP";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BRAND_ID = new ObjectId("6ab797f3bba7479a91b0a953");

async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", cookie: GB } });
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }
  throw new Error("gave up " + url);
}

// ---------- Shopify (read-only) ----------
const API = "2025-07";
let token;
async function shopifyToken() {
  if (env.SHOPIFY_ADMIN_ACCESS_TOKEN) return env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("no Shopify token");
  return j.access_token;
}
async function gql(query, variables, attempt = 0) {
  const res = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  const throttled = (j.errors || []).some((e) => e.extensions?.code === "THROTTLED");
  if ((throttled || res.status >= 500) && attempt < 6) { await sleep(2000 * (attempt + 1)); return gql(query, variables, attempt + 1); }
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

(async () => {
  // ---- Phase 1: our side ----
  const opts = { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 };
  const c1 = await new MongoClient(env.MONGODB_URI, opts).connect();
  const c2 = await new MongoClient(env.MONGODB_URL2, opts).connect();
  const proj = { name: 1, sourceUrl: 1, sourceProductId: 1, shopifyProductId: 1, stock: 1, stockStatus: 1, isOutOfStock: 1,
    "variants.name": 1, "variants.sku": 1, "variants.sourceUrl": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 };
  const ours = await c2.db().collection("products").find({ brand: BRAND_ID }).project(proj).toArray();
  const strays = await c1.db().collection("products").countDocuments({ brand: BRAND_ID });
  await c1.close(); await c2.close();

  const ourVariants = [];
  for (const p of ours) for (const v of p.variants || []) {
    const m = String(v.sourceUrl || "").match(/variant=(\d+)/);
    ourVariants.push({ pid: String(p._id), product: p.name, handle: (p.sourceUrl || "").split("/products/")[1], liveId: m ? m[1] : null,
      sku: v.sku, name: v.name, available: v.available, stock: v.stock, shopifyVariantId: v.shopifyVariantId || null });
  }
  const liveIdCounts = new Map();
  for (const v of ourVariants) if (v.liveId) liveIdCounts.set(v.liveId, (liveIdCounts.get(v.liveId) || 0) + 1);
  const dupLiveIds = [...liveIdCounts].filter(([, n]) => n > 1).length;

  // ---- Phase 2a: live products.json ----
  const live = [];
  for (let page = 1; page < 50; page++) {
    const d = await getJson(`${ORIGIN}/products.json?limit=250&page=${page}`);
    if (!d.products?.length) break;
    live.push(...d.products);
    await sleep(400);
  }
  const liveVar = new Map();
  for (const p of live) for (const v of p.variants || [])
    liveVar.set(String(v.id), { liveId: String(v.id), liveProductId: String(p.id), handle: p.handle, product: p.title, title: v.title, sku: v.sku, available: v.available });

  // ---- Phase 2b: Shopify variants (read-only) ----
  token = await shopifyToken();
  const loc = await gql(`{ locations(first:10, includeInactive:false){ nodes{ id name isActive } } }`);
  const ids = ourVariants.map((v) => v.shopifyVariantId).filter(Boolean);
  const shop = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: ids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
    await sleep(300);
  }

  // ---- compare ----
  const ourLiveIds = new Set(ourVariants.map((v) => v.liveId).filter(Boolean));
  const rows = ourVariants.map((v) => {
    const l = v.liveId ? liveVar.get(v.liveId) : null;
    const s = v.shopifyVariantId ? shop.get(v.shopifyVariantId) : null;
    return { ...v, live: l ? l.available : null, shopifyQty: s ? s.inventoryQuantity : null, shopifyPolicy: s?.inventoryPolicy ?? null,
      tracked: s?.inventoryItem?.tracked ?? null, inventoryItemId: s?.inventoryItem?.id ?? null };
  });
  const matched = rows.filter((r) => r.live !== null);
  const summary = {
    ours: { products: ours.length, variants: ourVariants.length, withLiveId: ourVariants.filter((v) => v.liveId).length, dupLiveIds, straysInDB1: strays,
      dbAvailableTrue: ourVariants.filter((v) => v.available !== false).length },
    live: { products: live.length, variants: liveVar.size, available: [...liveVar.values()].filter((v) => v.available).length },
    match: {
      matchedVariants: matched.length,
      ourVariantsGoneFromLive: rows.filter((r) => r.liveId && r.live === null).length,
      liveVariantsNotOnOurSite: [...liveVar.keys()].filter((k) => !ourLiveIds.has(k)).length,
      liveInStock: matched.filter((r) => r.live).length,
      liveSoldOut: matched.filter((r) => !r.live).length,
      dbSaysInStockButLiveSoldOut: matched.filter((r) => !r.live && r.available !== false).length,
    },
    shopify: {
      location: loc.locations.nodes,
      variantsFound: shop.size, ourVariantsWithoutShopifyVariant: ourVariants.filter((v) => !v.shopifyVariantId).length,
      shopifyIdNotFound: ids.length - shop.size,
      notTracked: rows.filter((r) => r.tracked === false).length,
      policy: rows.reduce((a, r) => ((a[r.shopifyPolicy] = (a[r.shopifyPolicy] || 0) + 1), a), {}),
      qtyDistribution: rows.reduce((a, r) => { const k = r.shopifyQty == null ? "none" : r.shopifyQty <= 0 ? "<=0" : r.shopifyQty < 100 ? "1-99" : r.shopifyQty < 1000 ? "100-999" : ">=1000"; a[k] = (a[k] || 0) + 1; return a; }, {}),
      liveSoldOutButShopifyQtyPositive: matched.filter((r) => !r.live && r.shopifyQty > 0).length,
    },
  };

  // ---- Phase 2c: quantity probe, 5 variants max ----
  const inStock = matched.filter((r) => r.live).sort(() => Math.random() - 0.5).slice(0, 3);
  const soldOut = matched.filter((r) => !r.live).sort(() => Math.random() - 0.5).slice(0, 2);
  const probes = [];
  for (const r of [...inStock, ...soldOut]) {
    const res = await fetch(`${ORIGIN}/cart/add.js`, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json", cookie: GB },
      body: JSON.stringify({ items: [{ id: Number(r.liveId), quantity: 9999 }] }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    const setCookie = res.headers.get("set-cookie") || "";
    const cart = setCookie.match(/cart=([^;]+)/);
    if (cart) {
      await fetch(`${ORIGIN}/cart/clear.js`, { method: "POST", headers: { "user-agent": UA, cookie: `${GB}; cart=${cart[1]}` } }).catch(() => {});
    }
    probes.push({ liveId: r.liveId, product: r.product, variant: r.name, liveAvailable: r.live, status: res.status,
      message: body?.description || body?.message || null, addedQty: body?.items?.[0]?.quantity ?? body?.quantity ?? null });
    await sleep(1500);
  }
  summary.quantityProbe = probes;

  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, `phase12-${stamp}.json`), JSON.stringify({ summary, rows }, null, 1));
  fs.writeFileSync(path.join(OUT, `stock-${stamp}.json`), JSON.stringify([...liveVar.values()].map((v) => ({ ...v, fetchedAt: new Date().toISOString() }))));
  console.log(JSON.stringify(summary, null, 1));
  const ex = matched.filter((r) => !r.live && r.available !== false).slice(0, 5).map((r) => `${r.product} | ${r.name} | DB: in stock, Shopify qty ${r.shopifyQty} | live: SOLD OUT`);
  console.log("examples:\n" + ex.join("\n"));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
