/**
 * Sync every multi-variant product's variants to Shopify, in batches.
 *
 * Uses the same application code the admin action runs
 * (src/lib/shopify/sync-variants.ts), so nothing here is a second
 * implementation that could drift from production behaviour.
 *
 * Progress is written to scripts/_tmp-variant-sync-progress.json after every
 * product, and products already recorded there are skipped on the next run —
 * a rate limit or a crash costs one product, not the whole run.
 *
 *   npx tsx --require ./scripts/mongo-dns.cjs scripts/sync-all-variants.ts
 *
 *   LIMIT=10      products this run (default 10)
 *   DRY=1         report what would be sent, call nothing
 *   RESET=1       forget previous progress and start over
 *   MAX_VARIANTS  skip products with more variants than this (default: no cap)
 *   GAP_MS        pause between products (default 400ms, for Shopify's limiter)
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Product } from "../src/models/Product";
import { Brand } from "../src/models/Brand";
import {
  syncVariantsToShopify,
  type LinxVariantForShopify,
} from "../src/lib/shopify/sync-variants";
import { ensureShopifyProductLinked } from "../src/lib/shopify/sync-product";

const LIMIT = Number(process.env.LIMIT || 10);
const DRY = process.env.DRY === "1";
const GAP_MS = Number(process.env.GAP_MS || 400);
const MAX_VARIANTS = Number(process.env.MAX_VARIANTS || 0);
const PROGRESS = path.join(__dirname, "_tmp-variant-sync-progress.json");

type Row = {
  id: string;
  name: string;
  ok: boolean;
  created?: number;
  updated?: number;
  linked?: number;
  total?: number;
  error?: string;
  warnings?: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadProgress(): Record<string, Row> {
  if (process.env.RESET === "1") return {};
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
  } catch {
    return {};
  }
}

function buildPayload(product: {
  price: number;
  stock: number;
  shopifyOptions?: unknown;
  variants?: Record<string, unknown>[];
}): LinxVariantForShopify[] {
  const axisNames = Array.isArray(product.shopifyOptions)
    ? (product.shopifyOptions as { name?: string }[])
        .map((a) => String(a?.name || "").trim())
        .filter(Boolean)
    : [];

  return (product.variants || []).map((row, index) => {
    const options: { name: string; value: string }[] = [];
    const raw = row.options as Record<string, unknown> | null | undefined;
    if (raw && typeof raw === "object") {
      for (const [name, value] of Object.entries(raw)) {
        if (name && value != null && String(value).trim()) {
          options.push({ name, value: String(value) });
        }
      }
    }
    if (!options.length) {
      [row.option1, row.option2, row.option3].forEach((value, i) => {
        if (value && String(value).trim()) {
          options.push({
            name: axisNames[i] || `Option ${i + 1}`,
            value: String(value),
          });
        }
      });
    }
    return {
      key: String(row._id ?? index),
      name: String(row.name || `Variant ${index + 1}`),
      sku: (row.sku as string) || null,
      barcode: (row.barcode as string) || null,
      price: Number(row.price ?? product.price) || 0,
      compareAtPrice: (row.compareAtPrice as number) ?? null,
      stock: Number(row.stock ?? product.stock) || 0,
      options,
    };
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  const progress = loadProgress();
  // Only successes are skipped — a failure is retried on the next run, which
  // is the point of recording the reason rather than just the id.
  const done = new Set(
    Object.entries(progress)
      .filter(([, row]) => row.ok)
      .map(([id]) => id),
  );

  const query: Record<string, unknown> = { "variants.1": { $exists: true } };
  const all = await Product.find(query)
    .select("name price stock category subCategory description images tagline specs brand variants shopifyOptions shopifyProductId shopifyVariantId")
    .sort({ _id: 1 });

  const pending = all.filter((p) => {
    if (done.has(String(p._id))) return false;
    if (MAX_VARIANTS && (p.variants || []).length > MAX_VARIANTS) return false;
    return true;
  });

  console.log(
    `${all.length} multi-variant products, ${done.size} already done, ${pending.length} pending`,
  );
  console.log(`running ${Math.min(LIMIT, pending.length)} this batch${DRY ? " (DRY)" : ""}\n`);

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const product of pending.slice(0, LIMIT)) {
    const id = String(product._id);
    const count = (product.variants || []).length;
    const payload = buildPayload(product as never);
    const label = `${product.name.slice(0, 40).padEnd(42)} ${String(count).padStart(3)}v`;

    if (DRY) {
      console.log(`  [dry] ${label}  linked=${product.shopifyProductId ? "yes" : "no"}`);
      continue;
    }

    try {
      let brandName: string | null = null;
      if (product.brand) {
        const brand = await Brand.findById(product.brand).select("name").lean();
        brandName = (brand as { name?: string } | null)?.name ?? null;
      }

      const ids = await ensureShopifyProductLinked({
        name: product.name,
        description: product.description,
        price: product.price,
        stock: product.stock,
        category: product.category,
        subCategory: product.subCategory,
        brandName,
        images: product.images ?? [],
        tagline: product.tagline,
        specs: product.specs ?? {},
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: product.shopifyVariantId,
      });

      const result = await syncVariantsToShopify(ids.productId, payload);

      for (const [index, row] of (product.variants || []).entries()) {
        const key = String(row._id ?? index);
        if (result.linked[key]) row.shopifyVariantId = result.linked[key];
        if (result.inventoryItems[key]) {
          row.shopifyInventoryItemId = result.inventoryItems[key];
        }
      }
      product.shopifyProductId = ids.productId;
      product.shopifyVariantId = ids.variantId;
      product.shopifySyncError = null;
      product.shopifySyncedAt = new Date();
      await product.save();

      const linkedCount = Object.keys(result.linked).length;
      created += result.created;
      updated += result.updated;
      progress[id] = {
        id,
        name: product.name,
        ok: true,
        created: result.created,
        updated: result.updated,
        linked: linkedCount,
        total: count,
        warnings: result.warnings,
      };
      console.log(
        `  ok   ${label}  +${result.created} new, ${result.updated} upd, linked ${linkedCount}/${count}` +
          (result.warnings.length ? `  (${result.warnings.length} warning)` : ""),
      );
      for (const w of result.warnings) console.log(`         ! ${w}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      progress[id] = { id, name: product.name, ok: false, error: message, total: count };
      console.log(`  FAIL ${label}  ${message.slice(0, 140)}`);
    }

    fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
    await sleep(GAP_MS);
  }

  const okCount = Object.values(progress).filter((r) => r.ok).length;
  const failCount = Object.values(progress).filter((r) => !r.ok).length;
  console.log(
    `\nbatch: ${created} variants created, ${updated} updated, ${failed} products failed`,
  );
  console.log(`overall: ${okCount} ok, ${failCount} failed, ${all.length} total`);
  console.log(`progress -> ${PROGRESS}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
