/**
 * Push the repaired merged products to Shopify and record what comes back.
 *
 * The merges called `syncFullProductToShopify` but never saved the variant
 * GIDs it returned, so on the site every colour/size of a merged product has
 * no `shopifyVariantId` and checkout refuses the line. Their names, option
 * labels, SKUs and galleries have since been rebuilt in Mongo
 * (fix-merged-product-options / -variant-skus / restore-merged-variant-images),
 * and Shopify still carries the old ones ("30cm / Gold Polished Calcatta
 * Marble").
 *
 * Per product:
 *   1. Match each Mongo variant to its live Shopify variant — by SKU, else by
 *      the option labels it had before the options fix — so existing variants
 *      keep their ids and order history.
 *   2. If Shopify's option axes or values differ from Mongo's, realign them in
 *      one `productSet`, passing the matched ids. A Shopify variant nothing
 *      matched is a leftover of the old labelling and is removed by it.
 *   3. Run the full sync (title, copy, prices, gallery, variant images) with
 *      the gallery pointed at URLs already verified to load, and pre-pair any
 *      image that is this product's own Shopify media so it is not re-uploaded.
 *   4. Save the returned ids, handle and image pairs; re-read Shopify and check
 *      every variant is linked at its Mongo price.
 *
 *   node scripts/sync-merged-products-to-shopify.cjs --id=<id>          # plan one, no writes
 *   node scripts/sync-merged-products-to-shopify.cjs --id=<id> --apply
 *   node scripts/sync-merged-products-to-shopify.cjs --apply [--limit=N]
 */
require("tsx/cjs");
require("dotenv").config({ path: ".env.local" });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));

const fs = require("fs");
const path = require("path");
const { MongoClient, BSON } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");

const APPLY = process.argv.includes("--apply");
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);
const ONLY_ID = arg("id");
const LIMIT = Number(arg("limit")) || Infinity;
const SKIP_DONE = !process.argv.includes("--all");
const BACKUPS = path.join(__dirname, "../backups");
const RESTORE_REPORT = path.join(BACKUPS, "merged-image-restore-report-2026-09-26T10-00-23-274Z.json");
const OPTIONS_BACKUP = fs
  .readdirSync(BACKUPS)
  .filter((f) => /^pre-options-fix-.*\.ejson$/.test(f))
  .sort()
  .map((f) => path.join(BACKUPS, f))[0];
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const REPORT = path.join(BACKUPS, `merged-shopify-sync-report-${STAMP}.json`);
const UNDO = path.join(BACKUPS, `pre-shopify-sync-${STAMP}.ejson`);
const VIDEO_URL = /\.(mp4|webm|mov)(\?|$)|youtube\.com|youtu\.be|vimeo\.com|^youtube:/i;

const trim = (v) => String(v ?? "").trim();
const norm = (v) => trim(v).toLowerCase();
const urlKey = (u) => trim(u).split("?")[0].toLowerCase();
const labelsOf = (v, axes) => axes.map((a) => trim(v.options?.[a]));
const signature = (values) => values.map(norm).join(" / ");

function loadOldLabels() {
  const map = new Map();
  if (!OPTIONS_BACKUP) return map;
  for (const line of fs.readFileSync(OPTIONS_BACKUP, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const { doc } = BSON.EJSON.parse(line, { relaxed: true });
    for (const v of doc.variants || []) {
      map.set(String(v._id), signature([v.option1, v.option2].filter(Boolean)));
    }
  }
  return map;
}

async function fetchShopify(productId) {
  const data = await shopifyAdminRequest(
    `query($id: ID!) {
      product(id: $id) {
        id status
        options { name }
        variants(first: 250) { nodes { id sku price selectedOptions { name value } } }
        media(first: 250) { nodes { id status ... on MediaImage { image { url } } } }
      }
    }`,
    { id: productId },
  );
  return data.product;
}

/** Mongo variant index → Shopify variant node. */
function matchVariants(doc, live, oldLabels) {
  const bySku = new Map();
  const bySig = new Map();
  for (const n of live.variants.nodes) {
    if (n.sku) bySku.set(norm(n.sku), n);
    bySig.set(signature(n.selectedOptions.map((o) => o.value)), n);
  }
  const used = new Set();
  const matches = doc.variants.map((v) => {
    const candidates = [
      v.shopifyVariantId && live.variants.nodes.find((n) => n.id === v.shopifyVariantId),
      v.sku && bySku.get(norm(v.sku)),
      oldLabels.get(String(v._id)) && bySig.get(oldLabels.get(String(v._id))),
    ];
    const hit = candidates.find((n) => n && !used.has(n.id)) || null;
    if (hit) used.add(hit.id);
    return hit;
  });
  const leftovers = live.variants.nodes.filter((n) => !used.has(n.id));
  return { matches, leftovers };
}

async function realignOptions(doc, axes, matches) {
  const productOptions = axes.length
    ? axes.map((name) => ({
        name,
        values: [...new Set(doc.variants.map((v) => trim(v.options?.[name])))].map((value) => ({ name: value })),
      }))
    : [{ name: "Title", values: [{ name: "Default Title" }] }];
  const variants = doc.variants.map((v, i) => ({
    ...(matches[i] ? { id: matches[i].id } : {}),
    optionValues: axes.length
      ? axes.map((a) => ({ optionName: a, name: trim(v.options?.[a]) }))
      : [{ optionName: "Title", name: "Default Title" }],
    price: String(Number(v.price) || Number(doc.price) || 0),
    ...(v.sku ? { sku: String(v.sku) } : {}),
  }));
  const data = await shopifyAdminRequest(
    `mutation($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product { id }
        userErrors { field message code }
      }
    }`,
    { input: { id: doc.shopifyProductId, productOptions, variants } },
  );
  const errors = data.productSet.userErrors || [];
  if (errors.length) throw new Error(`productSet: ${errors.map((e) => e.message).join("; ")}`);
}

async function syncOne(doc, brandName, oldLabels, entry) {
  const axes = (doc.shopifyOptions || []).map((o) => trim(o.name)).filter(Boolean);

  // Verified URLs: `shopifyImages[].shopifyUrl` loads (checked by the image restore).
  const working = new Map();
  for (const p of doc.shopifyImages || []) {
    if (p?.sourceUrl && p?.shopifyUrl) working.set(trim(p.sourceUrl), trim(p.shopifyUrl));
  }
  const toWorking = (u) => working.get(trim(u)) || trim(u);
  const videos = (doc.images || []).filter((u) => VIDEO_URL.test(u));
  const gallery = [...new Set((doc.images || []).filter((u) => !VIDEO_URL.test(u)).map(toWorking))];

  let live = doc.shopifyProductId ? await fetchShopify(doc.shopifyProductId) : null;
  if (doc.shopifyProductId && !live) entry.notes.push("stored Shopify product no longer exists — will be recreated");

  // 1–2. Variants and option axes.
  if (live && doc.variants.length) {
    const { matches, leftovers } = matchVariants(doc, live, oldLabels);
    const liveAxes = live.options.map((o) => o.name);
    const wantAxes = axes.length ? axes : ["Title"];
    const valuesDiffer = doc.variants.some((v, i) => {
      if (!matches[i]) return true;
      const have = matches[i].selectedOptions.map((o) => o.value);
      const want = axes.length ? labelsOf(v, axes) : ["Default Title"];
      return signature(have) !== signature(want);
    });
    const needSet = doc.variants.length >= 2 || axes.length === 0
      ? liveAxes.join("|") !== wantAxes.join("|") || valuesDiffer || leftovers.length > 0
      : false;
    entry.matched = matches.filter(Boolean).length;
    entry.toCreate = matches.filter((m) => !m).length;
    entry.removeFromShopify = leftovers.map((n) => `${n.selectedOptions.map((o) => o.value).join(" / ")} (sku ${n.sku || "-"})`);
    entry.optionsBefore = liveAxes.join(" + ");
    entry.optionsAfter = wantAxes.join(" + ");
    entry.realign = needSet;
    if (needSet && APPLY) {
      await realignOptions(doc, axes, matches);
      live = await fetchShopify(doc.shopifyProductId);
    }
  }

  // 3. Pair images that are this product's own Shopify media, so the
  //    reconcile keeps them instead of deleting and re-uploading.
  const liveMedia = new Map(
    (live?.media?.nodes || [])
      .filter((n) => n.status !== "FAILED" && n.image?.url)
      .map((n) => [urlKey(n.image.url), n]),
  );
  const known = gallery
    .map((u, i) => {
      const n = liveMedia.get(urlKey(u));
      return n ? { sourceUrl: u, shopifyUrl: n.image.url, mediaId: n.id, position: i } : null;
    })
    .filter(Boolean);
  // With nothing paired, the reconcile adopts existing media by position when
  // the counts match — which would label the old photos as the new ones.
  // A single throwaway pairing to an image that is not live switches that off.
  if (!known.length && live?.media?.nodes?.length === gallery.length && gallery.length) {
    known.push({ sourceUrl: "about:none", shopifyUrl: "", mediaId: "gid://shopify/MediaImage/0", position: 0 });
  }
  entry.images = gallery.length;
  entry.imagesAlreadyOnProduct = known.filter((k) => k.shopifyUrl).length;
  if (!APPLY) return null;

  const syncDoc = {
    ...doc,
    images: gallery,
    shopifyImages: known,
    variants: doc.variants.map((v) => ({ ...v, imageUrl: toWorking(v.imageUrl) })),
  };
  const result = await syncFullProductToShopify(syncDoc, brandName);
  entry.warnings = result.warnings;
  entry.variantsLinked = `${result.variantsLinked}/${result.variantsTotal}`;
  entry.status = result.status;

  // 4. Persist what Shopify returned.
  const links = syncDoc.shopifyImages || [];
  const bySource = new Map(links.map((l) => [trim(l.sourceUrl), l]));
  const pairFor = (u) => bySource.get(toWorking(u)) || bySource.get(trim(u));
  const variants = doc.variants.map((v, i) => {
    const synced = syncDoc.variants[i];
    const own = (v.shopifyImages || [])
      .map((p) => pairFor(p.shopifyUrl) || pairFor(p.sourceUrl))
      .filter(Boolean)
      .map((l, j) => ({ sourceUrl: l.sourceUrl, shopifyUrl: l.shopifyUrl, position: j + 1 }));
    const lead = pairFor(v.imageUrl) || own[0];
    return {
      ...v,
      imageUrl: lead?.sourceUrl || synced.imageUrl || v.imageUrl,
      shopifyImageUrl: lead?.shopifyUrl || synced.shopifyImageUrl || v.shopifyImageUrl || "",
      ...(own.length ? { shopifyImages: own } : {}),
      ...(synced.shopifyVariantId ? { shopifyVariantId: synced.shopifyVariantId } : {}),
      ...(synced.shopifyInventoryItemId ? { shopifyInventoryItemId: synced.shopifyInventoryItemId } : {}),
      ...(synced.shopifyMediaId ? { shopifyMediaId: synced.shopifyMediaId } : {}),
    };
  });
  const update = {
    shopifyProductId: syncDoc.shopifyProductId,
    shopifyVariantId: syncDoc.shopifyVariantId,
    shopifyHandle: syncDoc.shopifyHandle,
    shopifyProductUrl: syncDoc.shopifyProductUrl,
    shopifySyncedAt: new Date(),
    shopifySyncError: null,
    variants,
  };
  // Only replace the gallery when Shopify took every image; otherwise keep the
  // working pairs we had and say so.
  if (links.length >= gallery.length) {
    update.images = [...links.map((l) => l.sourceUrl), ...videos];
    update.shopifyImages = links.map((l, i) => ({ ...l, position: i + 1 }));
  } else {
    entry.notes.push(`Shopify holds ${links.length}/${gallery.length} images — gallery pairs left as they were`);
  }
  return update;
}

async function verify(doc, update, entry) {
  const live = await fetchShopify(update.shopifyProductId);
  const byId = new Map((live?.variants?.nodes || []).map((n) => [n.id, n]));
  const problems = [];
  for (const v of update.variants) {
    const n = byId.get(v.shopifyVariantId);
    if (!n) problems.push(`${v.name}: not linked`);
    else if (Math.abs(Number(n.price) - Number(v.price)) > 0.005) problems.push(`${v.name}: Shopify £${n.price} vs £${v.price}`);
  }
  entry.shopifyVariants = live?.variants?.nodes?.length ?? 0;
  entry.problems = problems;
}

async function main() {
  const oldLabels = loadOldLabels();
  const primary = new MongoClient(process.env.MONGODB_URI);
  const secondary = new MongoClient(process.env.MONGODB_URL2);
  await primary.connect();
  await secondary.connect();
  const brands = new Map(
    (await primary.db("test").collection("brands").find({}).project({ name: 1 }).toArray()).map((b) => [String(b._id), b.name]),
  );
  const col = secondary.db("test").collection("products");

  const ids = ONLY_ID
    ? [ONLY_ID]
    : JSON.parse(fs.readFileSync(RESTORE_REPORT, "utf8")).products.filter((p) => !p.skipped).map((p) => p.id);
  const filter = { _id: { $in: ids.map((i) => new BSON.ObjectId(i)) } };
  // A product whose every variant is already linked was done by an earlier run.
  if (SKIP_DONE && !ONLY_ID) filter.variants = { $elemMatch: { shopifyVariantId: { $in: [null, ""] } } };
  const docs = (await col.find(filter).toArray()).slice(0, LIMIT);
  console.log(`${docs.length} products to ${APPLY ? "sync" : "plan"}`);

  const report = [];
  let n = 0;
  for (const doc of docs) {
    n++;
    const entry = { id: String(doc._id), name: doc.name, variants: doc.variants.length, notes: [] };
    report.push(entry);
    try {
      const update = await syncOne(doc, brands.get(String(doc.brand)) || null, oldLabels, entry);
      if (update) {
        fs.appendFileSync(UNDO, BSON.EJSON.stringify({ cluster: "secondary", doc }, { relaxed: false }) + "\n");
        await col.updateOne({ _id: doc._id }, { $set: update });
        await verify(doc, update, entry);
      }
      const flag = entry.error || entry.problems?.length ? "✗" : "✓";
      console.log(
        `[${n}/${docs.length}] ${flag} ${entry.name} — ${entry.variantsLinked || `${entry.matched ?? 0} matched, ${entry.toCreate ?? entry.variants} new`}` +
          (entry.realign ? `, options ${entry.optionsBefore} → ${entry.optionsAfter}` : "") +
          (entry.removeFromShopify?.length ? `, remove ${entry.removeFromShopify.length} stale` : "") +
          (entry.problems?.length ? ` | ${entry.problems.join("; ")}` : ""),
      );
    } catch (e) {
      entry.error = e.message;
      console.log(`[${n}/${docs.length}] ✗ ${entry.name} — ${e.message}`);
    }
    fs.writeFileSync(REPORT, JSON.stringify({ mode: APPLY ? "apply" : "plan", products: report }, null, 2));
  }

  const ok = report.filter((r) => !r.error && !r.problems?.length).length;
  console.log(`\n${ok}/${report.length} clean. Report: ${REPORT}`);
  if (APPLY) console.log(`Previous versions: ${UNDO}`);
  else console.log("Plan only — nothing written. Re-run with --apply.");
  await primary.close();
  await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
