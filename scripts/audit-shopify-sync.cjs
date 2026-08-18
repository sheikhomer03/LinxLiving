/**
 * Audit the Shopify sync: are the stored URLs real, and does Shopify hold
 * anything Mongo has lost track of?
 *
 * Three questions the sync cannot answer about itself:
 *
 *   1. Do the Shopify CDN URLs we recorded actually serve a file? A URL is
 *      captured the moment Shopify reports it, and nothing since has fetched
 *      one. A sample is HEAD-checked here.
 *   2. Does Shopify hold products no Mongo row points at? That is the signature
 *      of a product created on Shopify whose id never made it back — the push
 *      would build it again on the next run rather than reuse it.
 *   3. Is any Shopify id claimed by more than one Mongo row, or any gallery
 *      pairing internally inconsistent?
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-shopify-sync.cjs
 *   SAMPLE=600   CDN urls to probe (0 skips the probe)
 *   FULL=1       probe every stored CDN url — slow
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const SAMPLE = process.env.FULL === "1" ? Infinity : Number(process.env.SAMPLE ?? 600);
const SKIP_ORPHANS = process.env.SKIP_ORPHANS === "1";
const PROBE_CONCURRENCY = Number(process.env.PROBE_CONCURRENCY) || 40;

async function probeAll(urls) {
  const results = { ok: 0, notFound: 0, other: [], errors: [], samples: [], dead: [] };
  let i = 0;
  let done = 0;
  const startedAt = Date.now();

  async function worker() {
    for (;;) {
      const index = i++;
      if (index >= urls.length) return;
      const url = urls[index];
      try {
        // Without a deadline a single stalled connection parks its worker for
        // good; twenty of those and the sweep never finishes.
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 200) results.ok += 1;
        else if (res.status === 404) results.notFound += 1;
        else results.other.push(`${res.status} ${url}`);
        // `samples` is for showing the operator; it must not double as a
        // counter, or a 404 lands in both tallies and the failure rate doubles.
        if (res.status !== 200) {
          results.dead.push({ url, status: res.status });
          if (results.samples.length < 12) {
            results.samples.push(`${res.status} ${url}`);
          }
        }
      } catch {
        results.errors.push(url);
      }
      done += 1;
      if (done % 2000 === 0) {
        const rate = done / ((Date.now() - startedAt) / 1000);
        process.stdout.write(
          `  ${done}/${urls.length}  ${rate.toFixed(0)}/s  ` +
            `dead ${results.notFound + results.other.length}  ` +
            `eta ${Math.round((urls.length - done) / rate / 60)}m\n`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));

  // A connection dropped under twenty-way concurrency says nothing about the
  // file. Anything that errored is retried one at a time before being counted
  // as broken — on the first run every one of them came back 200.
  if (results.errors.length) {
    const stillBad = [];
    for (const url of results.errors) {
      try {
        // Same deadline as the parallel pass — without it one unresponsive
        // host parks the retry loop after the sweep has otherwise finished.
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 200) results.ok += 1;
        else { stillBad.push(`${res.status} ${url}`); results.dead.push({ url, status: res.status }); }
      } catch (e) {
        stillBad.push(`${String(e.message).slice(0, 40)} ${url}`);
        results.dead.push({ url, status: String(e.message).slice(0, 40) });
      }
    }
    results.retried = results.errors.length;
    results.errors = stillBad;
  }
  return results;
}

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  const conn = await connectMongo(process.env.MONGODB_URI);
  const col = conn.db.collection("products");

  // ---------------------------------------------------------------- structure
  console.log("=== STRUCTURE ===");
  const total = await col.countDocuments({});
  const linked = await col.countDocuments({ shopifyProductId: { $nin: [null, ""] } });
  console.log(`products ${total}, linked ${linked}, unlinked ${total - linked}`);

  const dupes = await col
    .aggregate([
      { $match: { shopifyProductId: { $nin: [null, ""] } } },
      { $group: { _id: "$shopifyProductId", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "n" },
    ])
    .toArray();
  console.log(`shopify ids claimed by >1 mongo row: ${dupes[0] ? dupes[0].n : 0}`);

  const badPairs = await col.countDocuments({
    shopifyImages: { $elemMatch: { $or: [{ sourceUrl: "" }, { mediaId: "" }] } },
  });
  console.log(`gallery pairs missing a source or media id: ${badPairs}`);

  const urlMismatch = await col.countDocuments({
    shopifyProductUrl: { $nin: [null, ""] },
    $expr: {
      $not: {
        $eq: [
          "$shopifyProductUrl",
          { $concat: ["https://", process.env.SHOPIFY_STORE_DOMAIN, "/products/", { $ifNull: ["$shopifyHandle", ""] }] },
        ],
      },
    },
  });
  console.log(`shopifyProductUrl not matching its handle: ${urlMismatch}`);

  const variantNoGid = await col.countDocuments({
    variants: { $elemMatch: { shopifyVariantId: { $in: [null, ""] } } },
  });
  console.log(`products holding a variant with no Shopify GID: ${variantNoGid}`);

  // ------------------------------------------------------------ orphan check
  console.log("\n=== SHOPIFY SIDE ===");
  const countData = await shopifyAdminRequest(`query { productsCount { count } }`);
  const shopifyCount = countData.productsCount.count;
  console.log(`products on Shopify: ${shopifyCount}`);
  console.log(`referenced by Mongo: ${linked}`);
  console.log(`difference:          ${shopifyCount - linked}`);

  if (!SKIP_ORPHANS && shopifyCount - linked !== 0) {
    const known = new Set(
      (await col.distinct("shopifyProductId", { shopifyProductId: { $nin: [null, ""] } })).map(String),
    );
    const orphans = [];
    let cursor = null;
    for (;;) {
      const page = await shopifyAdminRequest(
        `query($after: String) {
          products(first: 250, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id title status createdAt }
          }
        }`,
        { after: cursor },
      );
      for (const n of page.products.nodes) {
        if (!known.has(n.id)) orphans.push(n);
      }
      if (!page.products.pageInfo.hasNextPage) break;
      cursor = page.products.pageInfo.endCursor;
    }
    console.log(`\nShopify products no Mongo row points at: ${orphans.length}`);
    for (const o of orphans.slice(0, 10)) {
      console.log(`   ${o.createdAt}  ${o.status.padEnd(7)} ${String(o.title).slice(0, 55)}`);
    }
    if (orphans.length) {
      const out = path.join(__dirname, "..", "shopify-orphan-products.json");
      fs.writeFileSync(out, JSON.stringify(orphans, null, 2));
      console.log(`   full list -> ${out}`);
    }
  }

  // --------------------------------------------------------------- cdn probe
  if (SAMPLE > 0) {
    console.log("\n=== CDN URLS ===");
    // Deduplicated server-side and streamed. Pulling every product's image
    // arrays into memory in one `toArray()` moves tens of megabytes of
    // subdocuments and dropped the Atlas connection outright; all this stage
    // needs is the distinct URL strings.
    const urlCursor = col.aggregate(
      [
        {
          $project: {
            u: {
              $concatArrays: [
                { $ifNull: ["$shopifyImages.shopifyUrl", []] },
                { $ifNull: ["$variants.shopifyImageUrl", []] },
              ],
            },
          },
        },
        { $unwind: "$u" },
        { $match: { u: { $nin: [null, ""] } } },
        { $group: { _id: "$u" } },
      ],
      { allowDiskUse: true },
    );

    const unique = [];
    for await (const row of urlCursor) unique.push(row._id);
    console.log(`distinct stored CDN urls: ${unique.length}`);

    const notShopify = unique.filter((u) => !/^https:\/\/cdn\.shopify\.com\//i.test(u));
    console.log(`not on cdn.shopify.com: ${notShopify.length}`);
    for (const u of notShopify.slice(0, 5)) console.log(`   ${u.slice(0, 100)}`);

    // Evenly spaced sample, so the probe spans the whole catalogue rather than
    // whichever brand happens to sort first.
    let sample = unique;
    if (unique.length > SAMPLE) {
      const step = unique.length / SAMPLE;
      sample = Array.from({ length: SAMPLE }, (_, k) => unique[Math.floor(k * step)]);
    }
    console.log(`probing ${sample.length}…`);
    const res = await probeAll(sample);
    console.log(`  200 OK    ${res.ok}`);
    console.log(`  404       ${res.notFound}`);
    console.log(`  other     ${res.other.length}`);
    console.log(`  errors    ${res.errors.length}`);
    for (const line of res.samples.slice(0, 8)) console.log(`     ${line.slice(0, 110)}`);
    for (const line of res.errors.slice(0, 4)) console.log(`     ${line.slice(0, 110)}`);
    const bad = res.notFound + res.other.length + res.errors.length;
    console.log(
      bad
        ? `\n  ${bad} of ${sample.length} probed URLs did not serve a file (${((bad / sample.length) * 100).toFixed(3)}%)`
        : `\n  every probed URL served a file`,
    );

    if (res.dead.length) {
      // Name the products holding a dead URL — the count alone does not say
      // whose gallery is short, which is what anyone fixing this needs.
      const deadUrls = new Set(res.dead.map((d) => d.url));
      const affected = await col
        .find({
          $or: [
            { "shopifyImages.shopifyUrl": { $in: [...deadUrls] } },
            { "variants.shopifyImageUrl": { $in: [...deadUrls] } },
          ],
        })
        .project({ name: 1, shopifyProductId: 1, shopifyProductUrl: 1, shopifyImages: 1 })
        .toArray();

      const report = affected.map((p) => ({
        _id: String(p._id),
        name: p.name,
        shopifyProductUrl: p.shopifyProductUrl,
        deadUrls: (p.shopifyImages || [])
          .filter((i) => deadUrls.has(i.shopifyUrl))
          .map((i) => ({ shopifyUrl: i.shopifyUrl, sourceUrl: i.sourceUrl, mediaId: i.mediaId })),
        totalPairs: (p.shopifyImages || []).length,
      }));

      console.log(`  products affected: ${affected.length}`);
      for (const r of report.slice(0, 8)) {
        console.log(`   · ${String(r.name).slice(0, 48)} — ${r.deadUrls.length}/${r.totalPairs} dead`);
      }
      const out = path.join(__dirname, "..", "shopify-broken-cdn-urls.json");
      fs.writeFileSync(out, JSON.stringify({ probed: sample.length, dead: res.dead, products: report }, null, 2));
      console.log(`  full list -> ${out}`);
    }
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
