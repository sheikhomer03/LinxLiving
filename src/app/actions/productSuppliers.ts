"use server";

import connectDB from "@/lib/mongodb";
import { ProductSupplier } from "@/models/ProductSupplier";
import { Product } from "@/models/Product";
import { pickBestSupplierOffer } from "@/lib/pricingEngine";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

export async function getProductSuppliers(productId: string) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { success: false, offers: [] };
    }
    const offers = await ProductSupplier.find({ product: productId })
      .populate("supplier", "name slug priority isActive")
      .sort({ isPreferred: -1, priority: 1 })
      .lean();
    return { success: true, offers: JSON.parse(JSON.stringify(offers)) };
  } catch (error) {
    console.error("getProductSuppliers:", error);
    return { success: false, offers: [] };
  }
}

export async function upsertProductSupplier(input: {
  productId: string;
  supplierId: string;
  supplierSku?: string;
  manufacturerSku?: string;
  costPrice?: number | null;
  deliveryCost?: number | null;
  stock?: number;
  leadTimeDays?: number | null;
  priority?: number;
  isPreferred?: boolean;
  isActive?: boolean;
}) {
  try {
    await connectDB();
    const { productId, supplierId } = input;
    if (
      !mongoose.Types.ObjectId.isValid(productId) ||
      !mongoose.Types.ObjectId.isValid(supplierId)
    ) {
      return { success: false, error: "Invalid product or supplier" };
    }

    const now = new Date();
    const doc = await ProductSupplier.findOneAndUpdate(
      { product: productId, supplier: supplierId },
      {
        $set: {
          supplierSku: input.supplierSku || "",
          manufacturerSku: input.manufacturerSku || "",
          costPrice: input.costPrice ?? null,
          deliveryCost: input.deliveryCost ?? null,
          stock: input.stock ?? 0,
          leadTimeDays: input.leadTimeDays ?? null,
          priority: input.priority ?? 100,
          isPreferred: !!input.isPreferred,
          isActive: input.isActive !== false,
          lastStockSyncAt: now,
          lastPriceSyncAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (input.isPreferred) {
      await ProductSupplier.updateMany(
        { product: productId, _id: { $ne: doc._id } },
        { $set: { isPreferred: false } },
      );
      await Product.findByIdAndUpdate(productId, {
        supplier: supplierId,
        supplierSku: input.supplierSku || "",
        costPrice: input.costPrice ?? null,
        deliveryCost: input.deliveryCost ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
        stock: input.stock ?? 0,
      });
    }

    revalidatePath(`/admin/products/${productId}/edit`);
    return { success: true, offer: JSON.parse(JSON.stringify(doc)) };
  } catch (error) {
    console.error("upsertProductSupplier:", error);
    return { success: false, error: "Save failed" };
  }
}

export async function deleteProductSupplier(id: string) {
  try {
    await connectDB();
    await ProductSupplier.findByIdAndDelete(id);
    return { success: true };
  } catch (error) {
    console.error("deleteProductSupplier:", error);
    return { success: false, error: "Delete failed" };
  }
}

/** Apply best multi-supplier offer onto the product primary fields. */
export async function applyBestSupplierToProduct(productId: string) {
  try {
    await connectDB();
    const offers = await ProductSupplier.find({
      product: productId,
      isActive: true,
    }).lean();
    const best = pickBestSupplierOffer(offers as any[]);
    if (!best) return { success: false, error: "No active supplier offers" };

    const now = new Date();
    await Product.findByIdAndUpdate(productId, {
      supplier: (best as any).supplier,
      supplierSku: (best as any).supplierSku || "",
      costPrice: (best as any).costPrice,
      deliveryCost: (best as any).deliveryCost,
      leadTimeDays: (best as any).leadTimeDays,
      stock: (best as any).stock ?? 0,
      isOutOfStock: ((best as any).stock ?? 0) <= 0,
      stockSyncedAt: now,
      priceSyncedAt: now,
    });
    await ProductSupplier.updateMany(
      { product: productId },
      { $set: { isPreferred: false } },
    );
    await ProductSupplier.updateOne(
      { _id: (best as any)._id },
      { $set: { isPreferred: true } },
    );

    revalidatePath(`/admin/products/${productId}/edit`);
    return { success: true, offer: JSON.parse(JSON.stringify(best)) };
  } catch (error) {
    console.error("applyBestSupplierToProduct:", error);
    return { success: false, error: "Apply failed" };
  }
}
