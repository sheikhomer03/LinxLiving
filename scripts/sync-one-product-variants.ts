/**
 * Sync one product's variants to Shopify using the real application code.
 *
 * Exercises src/lib/shopify/sync-variants.ts exactly as the admin action does,
 * so what is proven here is the code that will run in production — not a
 * script-local reimplementation of it.
 *
 *   npx tsx --require ./scripts/mongo-dns.cjs scripts/sync-one-product-variants.ts <productId>
 *   DRY=1  print the variants that would be sent, call nothing
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Product } from "../src/models/Product";
import {
  syncVariantsToShopify,
  deriveOptionAxes,
  type LinxVariantForShopify,
} from "../src/lib/shopify/sync-variants";
import { ensureShopifyProductLinked } from "../src/lib/shopify/sync-product";
import { Brand } from "../src/models/Brand";

const DRY = process.env.DRY === "1";

async function main() {
  const productId = process.argv[2];
  if (!productId) throw new Error("usage: … sync-one-product-variants.ts <productId>");

  await mongoose.connect(process.env.MONGODB_URI as string);

  const product = await Product.findById(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  console.log(`Product: "${product.name}"`);
  console.log(`  price GBP${product.price}  stock ${product.stock}`);
  console.log(`  shopifyProductId: ${product.shopifyProductId || "(none)"}`);
  console.log(`  variants in Mongo: ${(product.variants || []).length}`);

  const axisNames = Array.isArray(product.shopifyOptions)
    ? (product.shopifyOptions as { name?: string }[])
        .map((a) => String(a?.name || "").trim())
        .filter(Boolean)
    : [];

  const payload: LinxVariantForShopify[] = (product.variants || []).map(
    (row: Record<string, unknown>, index: number) => {
      const options: { name: string; value: string }[] = [];
      const raw = row.options as Record<string, unknown> | null | undefined;
      if (raw && typeof raw === "object") {
        for (const [name, value] of Object.entries(raw)) {
          if (name && value != null && String(value).trim())
            options.push({ name, value: String(value) });
        }
      }
      if (!options.length) {
        [row.option1, row.option2, row.option3].forEach((value, i) => {
          if (value && String(value).trim())
            options.push({
              name: axisNames[i] || `Option ${i + 1}`,
              value: String(value),
            });
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
    },
  );

  console.log("\n  axes:", JSON.stringify(deriveOptionAxes(payload)));
  for (const v of payload)
    console.log(
      `    ${v.name.padEnd(28)} GBP${String(v.price).padEnd(9)} stock ${String(
        v.stock,
      ).padEnd(6)} sku=${v.sku || "-"}  ${v.options
        .map((o) => `${o.name}:${o.value}`)
        .join(" / ")}`,
    );

  if (DRY) {
    console.log("\nDRY=1 — nothing sent to Shopify");
    await mongoose.disconnect();
    return;
  }

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
  console.log(`\nlinked product: ${ids.productId}`);

  const result = await syncVariantsToShopify(ids.productId, payload);
  console.log(
    `created ${result.created}, updated ${result.updated}, orphaned ${result.orphaned.length}`,
  );
  for (const w of result.warnings) console.log("  warning:", w);

  for (const [index, row] of (product.variants || []).entries()) {
    const key = String(row._id ?? index);
    if (result.linked[key]) row.shopifyVariantId = result.linked[key];
    if (result.inventoryItems[key])
      row.shopifyInventoryItemId = result.inventoryItems[key];
  }
  product.shopifyProductId = ids.productId;
  product.shopifyVariantId = ids.variantId;
  product.shopifySyncedAt = new Date();
  await product.save();

  console.log("\nwritten back to Mongo:");
  for (const row of product.variants || [])
    console.log(`   ${String(row.name).padEnd(28)} ${row.shopifyVariantId || "(NOT LINKED)"}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
