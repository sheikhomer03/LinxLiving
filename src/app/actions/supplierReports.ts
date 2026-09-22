"use server";

import connectDB from "@/lib/mongodb";
import { Supplier } from "@/models/Supplier";
import { fedAggregate, fedCount } from "@/lib/mongoCluster";
import { PurchaseOrder } from "@/models/PurchaseOrder";
import { orderModel } from "@/lib/mongoCluster";

export async function getSupplierOpsReport() {
  try {
    await connectDB();
    const Order = await orderModel();

    const [
      supplierCount,
      activeSuppliers,
      productCount,
      lowStock,
      outOfStock,
      pos,
      recentOrders,
      priceChanges,
    ] = await Promise.all([
      Supplier.countDocuments(),
      Supplier.countDocuments({ isActive: true }),
      fedCount({ supplier: { $ne: null } }),
      fedCount({
        supplier: { $ne: null },
        stock: { $gt: 0, $lte: 5 },
      }),
      fedCount({
        supplier: { $ne: null },
        $or: [{ stock: { $lte: 0 } }, { isOutOfStock: true }],
      }),
      PurchaseOrder.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            cost: { $sum: "$totalCost" },
          },
        },
      ]),
      Order.find({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      })
        .select("totalAmount status paymentStatus createdAt")
        .lean(),
      fedCount({
        priceSyncedAt: {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    const dailySales = (recentOrders as any[])
      .filter((o) => o.paymentStatus === "Paid")
      .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

    /*
     * Totals per supplier, gathered from both clusters.
     *
     * `$avg` is asked for as a sum and a count rather than a mean: the
     * average of two clusters' averages is not the average of their
     * products, and weighting by the group size would still be wrong because
     * `$avg` skips documents where the field is null.
     */
    const bySupplierRaw = await fedAggregate<any>([
      { $match: { supplier: { $ne: null } } },
      {
        $group: {
          _id: "$supplier",
          products: { $sum: 1 },
          lowStock: {
            $sum: {
              $cond: [
                {
                  $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 5] }],
                },
                1,
                0,
              ],
            },
          },
          outOfStock: {
            $sum: { $cond: [{ $lte: ["$stock", 0] }, 1, 0] },
          },
          costSum: { $sum: { $ifNull: ["$costPrice", 0] } },
          costN: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ["$costPrice", null] }, null] }, 0, 1] },
          },
          marginSum: { $sum: { $ifNull: ["$marginPercent", 0] } },
          marginN: {
            $sum: {
              $cond: [{ $eq: [{ $ifNull: ["$marginPercent", null] }, null] }, 0, 1],
            },
          },
        },
      },
    ]);

    const bySupplier = [
      ...bySupplierRaw
        .reduce((acc: Map<string, any>, r: any) => {
          const k = String(r._id);
          const hit = acc.get(k);
          if (!hit) return acc.set(k, { ...r });
          for (const f of [
            "products",
            "lowStock",
            "outOfStock",
            "costSum",
            "costN",
            "marginSum",
            "marginN",
          ]) {
            hit[f] = (hit[f] || 0) + (r[f] || 0);
          }
          return acc;
        }, new Map<string, any>())
        .values(),
    ]
      .map((r: any) => ({
        ...r,
        avgCost: r.costN ? r.costSum / r.costN : null,
        avgMargin: r.marginN ? r.marginSum / r.marginN : null,
      }))
      .sort((a: any, b: any) => b.products - a.products)
      .slice(0, 50);

    const supplierIds = bySupplier.map((r) => r._id).filter(Boolean);
    const suppliers = await Supplier.find({ _id: { $in: supplierIds } })
      .select("name slug isActive integrationType lastStockSyncAt")
      .lean();
    const nameById = new Map(
      suppliers.map((s: any) => [String(s._id), s]),
    );

    const supplierPerformance = bySupplier.map((row) => {
      const s = nameById.get(String(row._id));
      return {
        supplierId: String(row._id),
        name: s?.name || "Unknown",
        slug: s?.slug || "",
        isActive: s?.isActive !== false,
        integrationType: s?.integrationType || "manual",
        lastStockSyncAt: s?.lastStockSyncAt || null,
        products: row.products,
        lowStock: row.lowStock,
        outOfStock: row.outOfStock,
        avgCost: row.avgCost != null ? Math.round(row.avgCost * 100) / 100 : null,
        avgMargin:
          row.avgMargin != null ? Math.round(row.avgMargin * 10) / 10 : null,
      };
    });

    return {
      success: true,
      report: {
        suppliers: { total: supplierCount, active: activeSuppliers },
        productsWithSupplier: productCount,
        lowStock,
        outOfStock,
        dailySales: Math.round(dailySales * 100) / 100,
        dailyOrders: recentOrders.length,
        priceChanges24h: priceChanges,
        purchaseOrders: pos,
        supplierPerformance,
      },
    };
  } catch (error) {
    console.error("getSupplierOpsReport:", error);
    return { success: false, report: null };
  }
}
