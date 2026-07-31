import connectDB from "@/lib/mongodb";
import { Supplier } from "@/models/Supplier";
import { Product } from "@/models/Product";
import { ProductSupplier } from "@/models/ProductSupplier";
import { SupplierSyncLog } from "@/models/SupplierSyncLog";
import { calculateSellPrice } from "@/lib/pricingEngine";
import type { ConnectorStockRow } from "@/lib/suppliers/connectors/types";

function numOrNull(raw: unknown) {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseCsvText(text: string): ConnectorStockRow[] {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitRow = (line: string) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if ((ch === "," || ch === ";") && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = splitRow(lines[0]).map((h) =>
    h.toLowerCase().replace(/\s+/g, ""),
  );
  const rows: ConnectorStockRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    const supplierSku = (
      row.suppliersku ||
      row.supplier_sku ||
      row.sku ||
      row.productcode ||
      ""
    ).trim();
    if (!supplierSku) continue;
    rows.push({
      supplierSku,
      stock: Math.max(0, Math.floor(numOrNull(row.stock || row.qty) ?? 0)),
      costPrice: numOrNull(row.costprice || row.cost),
      leadTimeDays: numOrNull(row.leadtimedays || row.leadtime),
      deliveryCost: numOrNull(row.deliverycost || row.delivery),
    });
  }
  return rows;
}

function parseJsonFeed(text: string): ConnectorStockRow[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.products)
      ? data.products
      : Array.isArray(data?.items)
        ? data.items
        : [];
  return list
    .map((row: any) => {
      const supplierSku = String(
        row.supplierSku || row.sku || row.productCode || "",
      ).trim();
      if (!supplierSku) return null;
      return {
        supplierSku,
        stock: Math.max(
          0,
          Math.floor(numOrNull(row.stock ?? row.qty ?? row.quantity) ?? 0),
        ),
        costPrice: numOrNull(row.costPrice ?? row.cost ?? row.price),
        leadTimeDays: numOrNull(row.leadTimeDays ?? row.leadTime),
        deliveryCost: numOrNull(row.deliveryCost ?? row.delivery),
      } as ConnectorStockRow;
    })
    .filter(Boolean) as ConnectorStockRow[];
}

async function fetchFeedRows(
  supplier: any,
): Promise<{ rows: ConnectorStockRow[]; source: string; connector: string }> {
  const type = String(supplier.integrationType || "manual");
  const feedUrl = String(supplier.feedUrl || supplier.apiEndpoint || "").trim();

  if (!feedUrl || type === "manual") {
    return {
      rows: [],
      source: "",
      connector: type,
    };
  }

  const res = await fetch(feedUrl, {
    headers: { Accept: "application/json,text/csv,*/*" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Feed HTTP ${res.status}`);
  }
  const text = await res.text();
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const format = String(supplier.feedFormat || "").toLowerCase();

  const isCsv =
    format === "csv" ||
    type === "csv" ||
    contentType.includes("csv") ||
    contentType.includes("text/plain") ||
    feedUrl.toLowerCase().endsWith(".csv");

  if (isCsv) {
    return { rows: parseCsvText(text), source: feedUrl, connector: "csv" };
  }

  return {
    rows: parseJsonFeed(text),
    source: feedUrl,
    connector: type === "rest" ? "rest" : "json_feed",
  };
}

async function applyRows(
  supplierId: string,
  rows: ConnectorStockRow[],
  applyMargin: boolean,
) {
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const now = new Date();

  for (const row of rows) {
    try {
      const product =
        (await Product.findOne({
          supplier: supplierId,
          supplierSku: row.supplierSku,
        })) ||
        (await Product.findOne({ supplierSku: row.supplierSku }));

      if (!product) {
        skipped += 1;
        continue;
      }

      const $set: Record<string, unknown> = {
        updatedAt: now,
        stock: row.stock,
        isOutOfStock: row.stock <= 0,
        stockSyncedAt: now,
      };
      if (row.costPrice != null) {
        $set.costPrice = row.costPrice;
        $set.priceSyncedAt = now;
      }
      if (row.leadTimeDays != null) $set.leadTimeDays = row.leadTimeDays;
      if (row.deliveryCost != null) $set.deliveryCost = row.deliveryCost;

      if (applyMargin && row.costPrice != null) {
        const priced = calculateSellPrice({
          costPrice: row.costPrice,
          deliveryCost: row.deliveryCost ?? (product as any).deliveryCost,
          importCost: (product as any).importCost,
          dutyCost: (product as any).dutyCost,
          packagingCost: (product as any).packagingCost,
          handlingCost: (product as any).handlingCost,
          overheadCost: (product as any).overheadCost,
          marginPercent: (product as any).marginPercent ?? 35,
          vatRate: (product as any).vatRate ?? 20,
        });
        $set.price = priced.sellPriceExVat;
        $set.priceSyncedAt = now;
      }

      await Product.updateOne({ _id: product._id }, { $set });

      await ProductSupplier.findOneAndUpdate(
        { product: product._id, supplier: supplierId },
        {
          $set: {
            supplierSku: row.supplierSku,
            stock: row.stock,
            costPrice: row.costPrice ?? null,
            deliveryCost: row.deliveryCost ?? null,
            leadTimeDays: row.leadTimeDays ?? null,
            lastStockSyncAt: now,
            lastPriceSyncAt: row.costPrice != null ? now : undefined,
            isActive: true,
          },
        },
        { upsert: true },
      );

      updated += 1;
    } catch (e: any) {
      skipped += 1;
      if (errors.length < 20) {
        errors.push(`${row.supplierSku}: ${e?.message || "failed"}`);
      }
    }
  }

  return { updated, skipped, errors };
}

/** Sync one supplier from configured feed/API URL. */
export async function syncSupplierCatalog(
  supplierId: string,
  opts?: { applyMargin?: boolean },
) {
  await connectDB();
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) {
    return { success: false as const, error: "Supplier not found" };
  }
  if (supplier.isActive === false) {
    return { success: false as const, error: "Supplier is inactive" };
  }

  const applyMargin = opts?.applyMargin !== false;
  let rows: ConnectorStockRow[] = [];
  let source = "";
  let connector = String(supplier.integrationType || "manual");

  try {
    const fetched = await fetchFeedRows(supplier);
    rows = fetched.rows;
    source = fetched.source;
    connector = fetched.connector;

    if (!rows.length) {
      const msg =
        connector === "manual" || !source
          ? "No feed URL configured — use CSV upload for this supplier"
          : "Feed returned 0 rows";
      await SupplierSyncLog.create({
        supplier: supplier._id,
        connector,
        source,
        success: false,
        updated: 0,
        skipped: 0,
        errors: [msg],
        message: msg,
      });
      await Supplier.updateOne(
        { _id: supplier._id },
        { $set: { lastSyncError: msg } },
      );
      return { success: false as const, error: msg, updated: 0, skipped: 0 };
    }

    const result = await applyRows(String(supplier._id), rows, applyMargin);
    const now = new Date();
    await Supplier.updateOne(
      { _id: supplier._id },
      {
        $set: {
          lastStockSyncAt: now,
          lastPriceSyncAt: now,
          lastSyncError: null,
        },
      },
    );
    await SupplierSyncLog.create({
      supplier: supplier._id,
      connector,
      source,
      success: true,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      message: `Updated ${result.updated} products`,
    });

    return {
      success: true as const,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      total: rows.length,
      connector,
      source,
    };
  } catch (e: any) {
    const msg = e?.message || "Sync failed";
    await Supplier.updateOne(
      { _id: supplier._id },
      { $set: { lastSyncError: msg } },
    );
    await SupplierSyncLog.create({
      supplier: supplier._id,
      connector,
      source,
      success: false,
      updated: 0,
      skipped: 0,
      errors: [msg],
      message: msg,
    });
    return { success: false as const, error: msg, updated: 0, skipped: 0 };
  }
}

/** Sync all active suppliers that have a feed/API URL. */
export async function syncAllSupplierCatalogs(opts?: { applyMargin?: boolean }) {
  await connectDB();
  const suppliers = await Supplier.find({
    isActive: true,
    integrationType: { $in: ["csv", "rest", "xml", "json_feed", "ftp", "sftp"] },
    $or: [
      { feedUrl: { $nin: ["", null] } },
      { apiEndpoint: { $nin: ["", null] } },
    ],
  })
    .select("_id name")
    .lean();

  const results = [];
  for (const s of suppliers) {
    const r = await syncSupplierCatalog(String(s._id), opts);
    results.push({ supplierId: String(s._id), name: s.name, ...r });
  }
  return { success: true as const, count: results.length, results };
}
