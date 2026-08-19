/**
 * Push the whole catalogue to Shopify — every product, its gallery, its
 * variants and their images — and record what Shopify gave back.
 *
 * It runs the same application code the admin uses (`syncFullProductToShopify`),
 * so what is proven here is what production runs. What it adds is everything a
 * run of this size needs and a server action cannot have: a resumable cursor,
 * pacing tuned to the shop's rate limit, and per-product error capture.
 *
 * Pause the product webhooks before running it — see
 * `scripts/shopify-product-webhooks.cjs`. Shopify announces every product this
 * script creates, and the inbound handler reads an unfamiliar GID as a product
 * that originated in Shopify, duplicating the row we just pushed from.
 *
 * Products with no price anywhere — neither their own nor a variant's — are
 * built in Shopify but held as Draft. Checkout charges whatever the variant
 * costs, so publishing a £0 product makes it orderable for nothing.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs
 *
 *   RESUME=1          continue from the last checkpoint instead of restarting
 *   LIMIT=200         stop after N products (a rehearsal)
 *   BRAND="Pooky"     only that brand
 *   IDS=a,b,c         only these Mongo product ids
 *   ONLY=unsynced     only products with no Shopify link yet
 *   ONLY=failed       only products carrying a sync error
 *   ONLY=sku          only products whose SKU never reached Shopify
 *   DRY=1             report what would be sent, call nothing
 *   CONCURRENCY=4     products in flight at once
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY = process.env.DRY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const BRAND = String(process.env.BRAND || "").trim();
const IDS = String(process.env.IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ONLY = String(process.env.ONLY || "").trim().toLowerCase();
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 4);

// The shop's bucket holds 2000 points and refills at 100/s, so several products
// can be in flight without being throttled. `admin.ts` reads both of these and
// still backs off on its own when the bucket runs low.
process.env.SHOPIFY_MAX_CONCURRENCY =
  process.env.SHOPIFY_MAX_CONCURRENCY || String(CONCURRENCY * 2);
process.env.SHOPIFY_MIN_GAP_MS = process.env.SHOPIFY_MIN_GAP_MS || "0";

const STATE_FILE = path.join(__dirname, ".shopify-sync-state.json");
const FAIL_LOG = path.join(__dirname, ".shopify-sync-failures.jsonl");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Retry a Mongo operation through a transient loss of the database.
 *
 * A run of this length spans hours, and Atlas connections drop — a DNS lookup
 * fails, a socket resets, the pool is torn down. Four separate jobs have died
 * that way mid-catalogue with the work half done. None of those failures meant
 * anything was wrong with the data; the connection simply went away and came
 * back a moment later. Anything that reads as a network fault is retried with
 * a widening pause; a genuine error still throws on the first attempt.
 */
async function withMongoRetry(label, fn, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const message = String(error && error.message);
      const transient =
        /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|pool|topology|network|server selection/i.test(
          message,
        ) || /Mongo(Network|ServerSelection|PoolCleared)/i.test(String(error && error.name));
      if (!transient || attempt >= attempts) throw error;
      const wait = Math.min(30000, 1000 * 2 ** attempt);
      console.warn(
        `  mongo ${label} failed (${message.slice(0, 70)}) — retry ${attempt}/${attempts - 1} in ${Math.round(wait / 1000)}s`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();

  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { Product } = require("../src/models/Product.ts");
  const { Brand } = require("../src/models/Brand.ts");
  const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
  const {
    shopifyAdminHealthcheck,
    shopifyCostStatus,
  } = require("../src/lib/shopify/admin.ts");
  const { isShopifySyncEnabled } = require("../src/lib/shopify/config.ts");

  if (!isShopifySyncEnabled()) {
    throw new Error("Shopify sync is disabled — set SHOPIFY_SYNC_ENABLED=true");
  }

  await connectMongo(process.env.MONGODB_URI);

  const health = await shopifyAdminHealthcheck();
  if (!health.ok) throw new Error(`Shopify unreachable: ${health.error}`);
  console.log(`shop: ${health.shop}  location: ${health.locationId}`);

  const brands = await Brand.find({}).select("name").lean();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));

  const filter = {};
  if (IDS.length) {
    filter._id = { $in: IDS.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (BRAND) {
    const brand = brands.find(
      (b) => String(b.name).toLowerCase() === BRAND.toLowerCase(),
    );
    if (!brand) throw new Error(`Brand "${BRAND}" not found`);
    filter.brand = brand._id;
  }
  if (ONLY === "unsynced") {
    filter.$or = [
      { shopifyProductId: null },
      { shopifyProductId: "" },
      { shopifyProductId: { $exists: false } },
    ];
  } else if (ONLY === "failed") {
    filter.shopifySyncError = { $nin: [null, ""] };
  } else if (ONLY === "sku") {
    // Products whose Shopify variant should carry a stock code but cannot have
    // been given one: only products without option axes are affected, because a
    // product with variants gets its SKUs per row from syncVariantsToShopify.
    // The product-level variant never had a SKU set at all.
    //
    // Resolved as an id list rather than a query predicate — the SKU can live
    // in four different fields, and a dot-index path like `variants.0.sku` does
    // not resolve against a subdocument array.
    const ids = await Product.aggregate(
      [
        { $match: { shopifyProductId: { $nin: [null, ""] } } },
        {
          $project: {
            n: { $size: { $ifNull: ["$variants", []] } },
            variantSku: { $arrayElemAt: [{ $ifNull: ["$variants.sku", []] }, 0] },
            linxSku: 1,
            supplierSku: 1,
            productCode: 1,
            specSku: "$specs.sku",
          },
        },
        { $match: { n: { $lte: 1 } } },
        {
          $project: {
            sku: {
              $cond: [
                { $eq: ["$n", 1] },
                { $ifNull: ["$variantSku", ""] },
                {
                  $ifNull: [
                    { $ifNull: ["$linxSku", null] },
                    {
                      $ifNull: [
                        { $ifNull: ["$supplierSku", null] },
                        { $ifNull: [{ $ifNull: ["$productCode", null] }, "$specSku"] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        { $match: { sku: { $type: "string", $ne: "" } } },
        { $project: { _id: 1 } },
      ],
      { allowDiskUse: true },
    );
    console.log(`ONLY=sku: ${ids.length} product(s) should carry a SKU`);
    filter._id = { $in: ids.map((r) => r._id) };
  }

  const prior = RESUME ? readState() : null;
  if (prior?.lastId) {
    console.log(`resuming after ${prior.lastId} (${prior.processed} done)`);
  } else if (!DRY) {
    fs.writeFileSync(FAIL_LOG, "");
  }

  const total = await Product.countDocuments(
    prior?.lastId
      ? { ...filter, _id: { $gt: new mongoose.Types.ObjectId(prior.lastId) } }
      : filter,
  );
  const target = Math.min(total, LIMIT);
  console.log(
    `${total} product(s) match${LIMIT === Infinity ? "" : `, syncing ${target}`}` +
      `  ·  concurrency ${CONCURRENCY}${DRY ? "  ·  DRY RUN" : ""}\n`,
  );

  const stats = {
    startedAt: prior?.startedAt || new Date().toISOString(),
    processed: prior?.processed || 0,
    created: prior?.created || 0,
    updated: prior?.updated || 0,
    failed: prior?.failed || 0,
    draft: prior?.draft || 0,
    variantsLinked: prior?.variantsLinked || 0,
    variantImages: prior?.variantImages || 0,
    images: prior?.images || 0,
    lastId: prior?.lastId || null,
  };

  const runStart = Date.now();
  let runProcessed = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\ninterrupted — finishing in-flight products, then saving state");
    stopping = true;
  });

  // Paged by `_id` rather than held open as one cursor. A run of this length
  // spends far longer on each batch than Mongo's ten-minute cursor idle timeout
  // allows, so a streaming cursor would be killed mid-catalogue. Paging also
  // makes the checkpoint exact: "everything up to this id is done".
  const PAGE = 200;
  let after = prior?.lastId ? new mongoose.Types.ObjectId(prior.lastId) : null;

  async function nextPage() {
    const query = { ...filter };
    if (after) query._id = { ...(filter._id || {}), $gt: after };
    return withMongoRetry("page fetch", () =>
      Product.find(query).sort({ _id: 1 }).limit(PAGE),
    );
  }

  function setFor(product, error) {
    const set = {
      shopifySyncedAt: new Date(),
      shopifySyncError: error || null,
    };

    // Record the link even when the sync failed.
    //
    // `syncFullProductToShopify` writes the ids onto the document the moment
    // Shopify returns them, and a later step can still throw — a throttle on the
    // variant push, a socket dropped mid-gallery. Keeping the ids only on the
    // success path meant those products kept their Shopify half and lost the
    // pointer to it: the retry could not find the product it had just built, so
    // it built another, and the first was left on the store referenced by
    // nothing. Ten products were orphaned that way before this was spotted.
    if (product.shopifyProductId) {
      set.shopifyProductId = product.shopifyProductId;
      set.shopifyVariantId = product.shopifyVariantId;
      if (product.shopifyHandle) {
        set.shopifyHandle = product.shopifyHandle;
        set.shopifyProductUrl = product.shopifyProductUrl || "";
      }
    }

    if (!error) {
      set.shopifyImages = product.shopifyImages || [];
      set.shopifyHandle = product.shopifyHandle || "";
      set.shopifyProductUrl = product.shopifyProductUrl || "";
      // Written by index rather than replacing the array, so a field this run
      // does not own — a price edit landing mid-run — is not rolled back.
      (product.variants || []).forEach((row, i) => {
        set[`variants.${i}.shopifyVariantId`] = row.shopifyVariantId || "";
        set[`variants.${i}.shopifyInventoryItemId`] =
          row.shopifyInventoryItemId || "";
        set[`variants.${i}.shopifyImageUrl`] = row.shopifyImageUrl || "";
        set[`variants.${i}.shopifyMediaId`] = row.shopifyMediaId || "";
      });
    }
    return set;
  }

  /**
   * Persist one product's Shopify ids as soon as they exist.
   *
   * Deliberately not batched. Shopify fires `products/create` immediately, and
   * the inbound webhook treats a GID it cannot find in Mongo as a product that
   * originated in Shopify — so every second the id goes unwritten is a second in
   * which our own push comes back as a duplicate. Batching fifty of these saved
   * nothing worth having: the run waits on Shopify, never on Mongo.
   */
  function persist(product, error) {
    return withMongoRetry("write", () =>
      Product.updateOne(
        { _id: product._id },
        { $set: setFor(product, error) },
        { timestamps: false },
      ),
    );
  }

  async function handle(product) {
    const wasLinked = Boolean(product.shopifyProductId);
    try {
      if (DRY) {
        console.log(
          `  would sync ${String(product.name).slice(0, 55)} · ` +
            `${(product.images || []).length} images · ` +
            `${(product.variants || []).length} variants · ` +
            `£${product.price}`,
        );
        return;
      }

      const report = await syncFullProductToShopify(
        product,
        brandName.get(String(product.brand)) || null,
      );

      await persist(product, null);
      if (wasLinked) stats.updated += 1;
      else stats.created += 1;
      if (report.status === "DRAFT") stats.draft += 1;
      stats.images += report.images;
      stats.variantsLinked += report.variantsLinked;
      stats.variantImages += report.variantImagesAttached;

      for (const warning of report.warnings) {
        fs.appendFileSync(
          FAIL_LOG,
          JSON.stringify({
            _id: String(product._id),
            name: product.name,
            warning,
          }) + "\n",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      await persist(product, message.slice(0, 500));
      fs.appendFileSync(
        FAIL_LOG,
        JSON.stringify({
          _id: String(product._id),
          name: product.name,
          error: message,
        }) + "\n",
      );
      console.error(`  ✗ ${String(product.name).slice(0, 50)} — ${message.slice(0, 140)}`);
    }
  }

  const inFlight = new Set();
  // Last product handed to a worker. Once the in-flight set has drained, every
  // product up to and including it is written — which is exactly what the
  // checkpoint claims. Taking the end of the page instead would skip whatever
  // remained unprocessed when the run stopped early.
  let lastStartedId = prior?.lastId || null;

  outer: for (;;) {
    const page = await nextPage();
    if (!page.length) break;
    after = page[page.length - 1]._id;

    for (const product of page) {
      if (stopping || runProcessed >= target) break outer;

      const task = handle(product).finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);

      runProcessed += 1;
      stats.processed += 1;
      lastStartedId = product._id;

      if (runProcessed % 50 === 0) {
        // Everything started so far has finished and been written, so the
        // checkpoint below is a true "done up to here".
        await Promise.all(inFlight);
        stats.lastId = String(product._id);
        if (!DRY) writeState(stats);

        const rate = runProcessed / ((Date.now() - runStart) / 1000);
        const left = target - runProcessed;
        const cost = shopifyCostStatus();
        console.log(
          `${String(runProcessed).padStart(6)}/${target}  ` +
            `created ${stats.created}  updated ${stats.updated}  ` +
            `draft ${stats.draft}  failed ${stats.failed}  ` +
            `${rate.toFixed(1)}/s  eta ${fmtDuration((left / Math.max(rate, 0.01)) * 1000)}  ` +
            `points ${Math.round(cost.available)}  ` +
            `req ${cost.requests} @${cost.avgLatencyMs}ms  ` +
            `peak ${cost.inFlightPeak}`,
        );
      }
    }
  }

  await Promise.all(inFlight);
  if (lastStartedId) stats.lastId = String(lastStartedId);
  if (!DRY) writeState(stats);

  console.log(
    `\ndone in ${fmtDuration(Date.now() - runStart)}\n` +
      `  products   ${stats.processed} (created ${stats.created}, updated ${stats.updated}, failed ${stats.failed})\n` +
      `  draft      ${stats.draft} (held off sale — no price)\n` +
      `  images     ${stats.images} paired with a Shopify URL\n` +
      `  variants   ${stats.variantsLinked} linked, ${stats.variantImages} variant images attached\n` +
      (stats.failed ? `  failures logged to ${FAIL_LOG}\n` : ""),
  );

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
