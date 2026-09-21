/**
 * Give a brand's Shopify products their real options and variants.
 *
 * The bulk import created every product with Shopify's implicit single
 * "Title / Default Title" variant, because the scrape read one JSON-LD block
 * of several and never saw the others. The catalogue actually sells them by
 * Finish and Option, at different prices — Caramel is £470 where Matt White
 * is £420 — so until each variant exists in Shopify with its own id the
 * storefront cannot offer the choice: `ProductSection` puts
 * `selectedVariant.shopifyVariantId` on the cart line and checkout resolves
 * the product's single variant instead, charging the wrong price.
 *
 * `productSet` installs the options and the whole variant set in one call.
 * The ids it returns are written back onto
 * `Product.variants[].shopifyVariantId`, matched by option VALUES rather than
 * by array position — Shopify returns variants in its own order and a
 * positional match would put ids on the wrong rows — and `shopifyOptions` is
 * filled in so the PDP knows which axes to render.
 *
 * Resumable: a product whose variants already carry ids is not selected.
 *
 * Env:
 *   BRAND=slug   brand to sync (default "drench")
 *   LIMIT=n      only the first n products
 *   DRY_RUN=1    build the payloads, call nothing
 *   ONLY=<id>    a single Mongo product _id, for a pilot run
 *   RESYNC=1     revisit products already stamped that still have variants
 *                without a Shopify id (e.g. ones an earlier run refused for
 *                being over a variant cap that has since been raised)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_SLUG = process.env.BRAND || "drench";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY = process.env.ONLY || "";
const RESYNC = process.env.RESYNC === "1";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
/** Shopify caps variants per product; stay well under and report the rest. */
const MAX_VARIANTS = Number(process.env.MAX_VARIANTS) || 100;

let token = null;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }
  const res = await fetch("https://" + DOMAIN + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("token exchange failed");
  return j.access_token;
}

async function admin(query, variables, attempt = 0) {
  try {
    const res = await fetch(
      "https://" + DOMAIN + "/admin/api/" + VERSION + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 240));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

const clean = (s) => String(s == null ? "" : s).trim();

/**
 * The option axes, built from the values the variants actually carry.
 *
 * `variantGroups` supplies the names the shop shows ("Finish", "Option");
 * the values come from the variants themselves, so an axis can never offer a
 * choice that no variant has.
 */
/**
 * What an axis is called when a variant simply does not use it.
 *
 * Some ranges offer a third choice only on some variants — a combination
 * unit sold with a toilet has a seat option, the same unit sold without one
 * has nothing to choose. Shopify has no concept of a blank option value, so
 * the gap needs a name; without one these variants were sent under the
 * axis's FIRST value instead, which collided with a real combination and
 * left their ids unmatched.
 */
const NO_VALUE = "None";

function buildOptions(groups, variants) {
  const axes = [];
  for (let i = 0; i < 3; i += 1) {
    const key = "option" + (i + 1);
    const values = [
      ...new Set(variants.map((v) => clean(v[key])).filter(Boolean)),
    ];
    if (!values.length) continue;
    // Offer the gap as a value of its own where any variant leaves it blank.
    if (variants.some((v) => !clean(v[key]))) values.push(NO_VALUE);
    /*
     * Trim the axis name. Some captured groups carry a trailing space
     * ("Watt "), Shopify stores the trimmed form, and matching its returned
     * options against the untrimmed name found nothing — the variants were
     * created correctly and then none of their ids could be written back.
     */
    axes.push({ name: clean(groups[i]) || "Option " + (i + 1), values, position: i + 1 });
  }
  return axes;
}

/** An axis value as Shopify will hold it, blanks included. */
const optionValue = (v, position) => clean(v["option" + position]) || NO_VALUE;

const variantKey = (values) =>
  values.map((v) => clean(v).toLowerCase()).join(" | ");

async function syncProduct(doc) {
  const variants = (doc.variants || []).filter((v) => clean(v.option1));
  if (!doc.shopifyProductId) return { skipped: "not in shopify" };
  if (variants.length < 2) return { skipped: "one variant" };
  if (variants.length > MAX_VARIANTS) {
    return { skipped: "too many variants (" + variants.length + ")" };
  }

  const axes = buildOptions(doc.variantGroups || [], variants);
  if (!axes.length) return { skipped: "no option values" };

  const productOptions = axes.map((a) => ({
    name: a.name,
    position: a.position,
    values: a.values.map((v) => ({ name: v })),
  }));

  /*
   * Two variants can land on the same option combination when the supplier
   * distinguishes them by something we do not carry. Shopify rejects the
   * whole product for a duplicate combination, so the first wins.
   */
  const seen = new Set();
  const rows = [];
  for (const v of variants) {
    const key = variantKey(axes.map((a) => optionValue(v, a.position)));
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(v);
  }

  const variantInput = rows.map((v) => {
    const price = Number(v.price) > 0 ? Number(v.price) : Number(doc.price) || 0;
    const input = {
      optionValues: axes.map((a) => ({
        optionName: a.name,
        name: optionValue(v, a.position),
      })),
      price: price.toFixed(2),
      /*
       * Inventory is not tracked, which is what makes the variant sellable.
       *
       * A variant Shopify creates defaults to tracked with a quantity of
       * zero and a DENY policy, so it reads as out of stock and cannot be
       * bought — the products this script had already touched all showed
       * "Out of stock" on the storefront. Every pre-existing variant in this
       * store is untracked, and `Product.stock` says why: nothing in this
       * catalogue is genuinely limited by units held.
       */
      inventoryItem: { tracked: false },
    };
    if (v.sku) input.inventoryItem.sku = String(v.sku);
    return input;
  });

  if (DRY_RUN) {
    return {
      dry: true,
      axes: axes.map((a) => a.name + "(" + a.values.length + ")").join(", "),
      variants: variantInput.length,
    };
  }

  const d = await admin(
    "mutation Set($input: ProductSetInput!) {" +
      "  productSet(synchronous: true, input: $input) {" +
      "    product { id variants(first: 250) { nodes { id sku inventoryItem { id } selectedOptions { name value } } } }" +
      "    userErrors { field message }" +
      "  }" +
      "}",
    { input: { id: doc.shopifyProductId, productOptions, variants: variantInput } },
  );

  const errs = (d.productSet && d.productSet.userErrors) || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; ").slice(0, 220));
  }

  const made = d.productSet.product.variants.nodes;
  const byKey = new Map(
    made.map((v) => [
      variantKey(
        axes.map((a) => {
          // Compare names loosely; Shopify may normalise what it was sent.
          const hit = v.selectedOptions.find(
            (o) => clean(o.name).toLowerCase() === clean(a.name).toLowerCase(),
          );
          return (hit || {}).value || "";
        }),
      ),
      v,
    ]),
  );

  let mapped = 0;
  const updates = variants.map((v) => {
    const hit = byKey.get(
      variantKey(axes.map((a) => optionValue(v, a.position))),
    );
    if (hit) mapped += 1;
    return {
      sku: v.sku,
      shopifyVariantId: hit ? hit.id : "",
      // The old brands in the primary store this too; stock pushes read it.
      shopifyInventoryItemId:
        hit && hit.inventoryItem ? hit.inventoryItem.id : "",
    };
  });

  return {
    axes: axes.map((a) => ({ name: a.name, values: a.values, position: a.position })),
    updates,
    created: made.length,
    mapped,
  };
}

async function main() {
  token = await adminToken();
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  let db = primary;
  let secConn = null;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
      .asPromise();
    db = secConn.db;
  }
  const P = db.collection("products");

  const base = {
    brand: brand._id,
    shopifyProductId: { $nin: [null, ""] },
    "variants.1": { $exists: true },
  };
  /*
   * Normally the stamp is what makes this resumable. A re-sync ignores it and
   * goes by the thing that actually matters — a variant still without an id —
   * so products an earlier run gave up on can be picked up again.
   */
  const filter = ONLY
    ? { _id: new mongoose.Types.ObjectId(ONLY) }
    : RESYNC
      ? {
          ...base,
          variants: { $elemMatch: { shopifyVariantId: { $in: [null, ""] } } },
        }
      : { ...base, shopifyVariantsSyncedAt: { $exists: false } };

  const total = await P.countDocuments(filter);
  console.log("brand    : " + brand.name + "  (" + (secConn ? "secondary" : "primary") + ")");
  console.log("to sync  : " + total + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  let done = 0, ok = 0, skipped = 0, failed = 0, variantsMade = 0;
  const started = Date.now();
  const target = Math.min(total, LIMIT === Infinity ? total : LIMIT);
  /*
   * Ids first, then fetch one at a time.
   *
   * Holding a cursor open across the Shopify calls let it idle past the
   * server's timeout and the run died with CursorNotFound at 750 products.
   * The id list is small and settles the work set before any slow call.
   */
  const ids = (
    await P.find(filter)
      .project({ _id: 1 })
      .limit(LIMIT === Infinity ? 0 : LIMIT)
      .toArray()
  ).map((d) => d._id);

  for (const _id of ids) {
    const doc = await P.findOne({ _id });
    if (!doc) continue;
    done += 1;
    try {
      const r = await syncProduct(doc);
      if (r.skipped) {
        skipped += 1;
        await P.updateOne(
          { _id: doc._id },
          { $set: { shopifyVariantsSyncedAt: new Date(), shopifyVariantSkip: r.skipped } },
        );
        continue;
      }
      if (r.dry) {
        ok += 1;
        if (ok <= 5) {
          console.log("  [dry] " + String(doc.name).slice(0, 42).padEnd(44) +
            r.axes + "  -> " + r.variants + " variants");
        }
        continue;
      }

      /*
       * `productSet` REPLACES the variant set, so the single "Default Title"
       * variant the import created is deleted and its id is dead. The
       * product-level `shopifyVariantId` still pointed at it, and every path
       * that falls back to the product rather than a chosen variant — the
       * cart line when no option is picked, the Shopify checkout resolve —
       * would have sent Shopify an id that no longer exists.
       */
      const set = {
        shopifyOptions: r.axes,
        shopifyVariantsSyncedAt: new Date(),
        // Created untracked above, so record it the way the repair script
        // does — otherwise these look like products still awaiting the fix.
        inventoryUntrackedAt: new Date(),
      };
      const lead = r.updates.find((u) => u.shopifyVariantId);
      if (lead) set.shopifyVariantId = lead.shopifyVariantId;
      for (const u of r.updates) {
        const i = (doc.variants || []).findIndex(
          (v) => String(v.sku) === String(u.sku),
        );
        if (i >= 0) {
          set["variants." + i + ".shopifyVariantId"] = u.shopifyVariantId;
          set["variants." + i + ".shopifyInventoryItemId"] =
            u.shopifyInventoryItemId;
        }
      }
      await P.updateOne({ _id: doc._id }, { $set: set, $unset: { shopifyVariantSyncError: "" } });

      ok += 1;
      variantsMade += r.created;
      if (ok <= 3) {
        console.log("  " + String(doc.name).slice(0, 42).padEnd(44) +
          "created " + r.created + "  ids mapped " + r.mapped + "/" + r.updates.length);
      }
    } catch (e) {
      failed += 1;
      const msg = String(e.message || e).slice(0, 180);
      await P.updateOne({ _id: doc._id }, { $set: { shopifyVariantSyncError: msg } });
      if (failed <= 10) {
        console.log("  FAIL " + String(doc.name).slice(0, 38) + " -> " + msg);
      }
    }

    if (done % 25 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((target - done) / Math.max(rate, 0.001) / 60);
      console.log("  " + done + "/" + target + "  ok " + ok + "  skipped " + skipped +
        "  failed " + failed + "  ~" + left + "m left");
    }
  }

  console.log("");
  console.log("products synced : " + ok);
  console.log("variants created: " + variantsMade);
  console.log("skipped         : " + skipped);
  console.log("failed          : " + failed);
  if (secConn) await secConn.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
