"use server";

import connectDB from "@/lib/mongodb";
import { SupplierSyncLog } from "@/models/SupplierSyncLog";
import {
  syncAllSupplierCatalogs,
  syncSupplierCatalog,
} from "@/lib/suppliers/syncEngine";
import { revalidatePath } from "next/cache";

export async function runSupplierSync(
  supplierId: string,
  applyMargin = true,
) {
  const result = await syncSupplierCatalog(supplierId, { applyMargin });
  revalidatePath("/admin/suppliers");
  revalidatePath("/admin/supplier-ops");
  revalidatePath("/admin/products");
  return result;
}

export async function runAllSupplierSyncs(applyMargin = true) {
  const result = await syncAllSupplierCatalogs({ applyMargin });
  revalidatePath("/admin/suppliers");
  revalidatePath("/admin/supplier-ops");
  revalidatePath("/admin/products");
  return result;
}

export async function getSupplierSyncLogs(limit = 40) {
  try {
    await connectDB();
    const logs = await SupplierSyncLog.find()
      .populate("supplier", "name slug")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return { success: true, logs: JSON.parse(JSON.stringify(logs)) };
  } catch (error) {
    console.error("getSupplierSyncLogs:", error);
    return { success: false, logs: [] };
  }
}
