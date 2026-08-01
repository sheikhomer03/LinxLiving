"use server";

import connectDB from "@/lib/mongodb";
import { Supplier } from "@/models/Supplier";
import { Product } from "@/models/Product";
import { PurchaseOrder } from "@/models/PurchaseOrder";
import { Order } from "@/models/Order";

export async function getSupplierOpsReport() {
  try {
    await connectDB();

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
      Product.countDocuments({ supplier: { $ne: null } }),
      Product.countDocuments({
        supplier: { $ne: null },
        stock: { $gt: 0, $lte: 5 },
      }),
      Product.countDocuments({
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
      Product.countDocuments({
        priceSyncedAt: {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    const dailySales = (recentOrders as any[])
      .filter((o) => o.paymentStatus === "Paid")
      .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

    const bySupplier = await Product.aggregate([
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
          avgCost: { $avg: "$costPrice" },
          avgMargin: { $avg: "$marginPercent" },
        },
      },
      { $sort: { products: -1 } },
      { $limit: 50 },
    ]);

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
