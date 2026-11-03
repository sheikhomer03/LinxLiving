import type { Model } from "mongoose";
import { isSoldOut } from "@/lib/pricedOnly";

/** The fields `isSoldOut` reads. */
const STOCK_FIELDS = ["stock", "isOutOfStock", "stockStatus", "variants"];

/**
 * An unsorted, limited read with the sold-out products left out, in the order
 * the same read returned before they were hidden.
 *
 * With no sort, Mongo returns whatever order its chosen plan produces. Putting
 * the stock test into the filter changes that plan, so the read came back as
 * a different set of in-stock products, not the same set less the sold-out
 * ones. Here the filter is left as it was — callers pass
 * `storefrontVisibilityClause({ includeStock: false })` — and sold-out rows
 * are dropped from the result, the next rows in the same order filling their
 * places.
 */
export async function findInStockKeepingOrder<T = any>(
  model: Model<any>,
  filter: Record<string, unknown>,
  select: string,
  take: number | null,
): Promise<T[]> {
  const selected = new Set(
    select.split(/\s+/).filter(Boolean).map((f) => f.split(".")[0]),
  );
  let query = model
    .find(filter)
    .select(`${select} stock isOutOfStock stockStatus variants.available`);
  // Room for the sold-out rows that are about to be dropped.
  if (take != null) query = query.limit(take * 4 + 20);
  const rows = (await query.lean()) as Record<string, unknown>[];

  const kept = rows.filter((r) => !isSoldOut(r as any));
  const page = take != null ? kept.slice(0, take) : kept;
  // Hand back only what the caller selected.
  return page.map((r) => {
    const out = { ...r };
    for (const f of STOCK_FIELDS) if (!selected.has(f)) delete out[f];
    return out as T;
  });
}
