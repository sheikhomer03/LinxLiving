"use server";

import connectDB from "@/lib/mongodb";
import { PurchaseOrder } from "@/models/PurchaseOrder";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Supplier } from "@/models/Supplier";
import { ProductSupplier } from "@/models/ProductSupplier";
import { pickBestSupplierOffer } from "@/lib/pricingEngine";
import {
  sendPurchaseOrderToSupplier,
  sendShipmentTrackingEmail,
} from "@/lib/mail";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";

async function nextPoNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = await PurchaseOrder.countDocuments({
    poNumber: new RegExp(`^PO-${day}-`),
  });
  return `PO-${day}-${String(count + 1).padStart(4, "0")}`;
}

export async function getPurchaseOrders(limit = 100) {
  try {
    await connectDB();
    const rows = await PurchaseOrder.find()
      .populate("supplier", "name slug email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return {
      success: true,
      purchaseOrders: JSON.parse(JSON.stringify(rows)),
    };
  } catch (error) {
    console.error("getPurchaseOrders:", error);
    return { success: false, purchaseOrders: [] };
  }
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: string,
  extras?: {
    trackingNumber?: string;
    trackingCarrier?: string;
    supplierConfirmationRef?: string;
    notes?: string;
    notifyCustomer?: boolean;
  },
) {
  try {
    await connectDB();
    const allowed = [
      "Draft",
      "Submitted",
      "Confirmed",
      "Partially Received",
      "Received",
      "Cancelled",
      "Failed",
    ];
    if (!allowed.includes(status)) {
      return { success: false, error: "Invalid status" };
    }

    const existing = await PurchaseOrder.findById(id).lean();
    if (!existing) return { success: false, error: "PO not found" };

    const prevTracking = String((existing as any).trackingNumber || "").trim();
    const nextTracking = String(
      extras?.trackingNumber != null
        ? extras.trackingNumber
        : (existing as any).trackingNumber || "",
    ).trim();

    const $set: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "Submitted") $set.submittedAt = new Date();
    if (status === "Confirmed") $set.confirmedAt = new Date();
    if (extras?.trackingNumber != null)
      $set.trackingNumber = extras.trackingNumber;
    if (extras?.trackingCarrier != null)
      $set.trackingCarrier = extras.trackingCarrier;
    if (extras?.supplierConfirmationRef != null)
      $set.supplierConfirmationRef = extras.supplierConfirmationRef;
    if (extras?.notes != null) $set.notes = extras.notes;

    await PurchaseOrder.findByIdAndUpdate(id, { $set });

    const trackingAdded =
      nextTracking &&
      nextTracking !== prevTracking &&
      extras?.notifyCustomer !== false;

    if (trackingAdded && (existing as any).order) {
      try {
        const order = await Order.findById((existing as any).order).lean();
        const email =
          (order as any)?.shippingAddress?.email ||
          (order as any)?.user?.email;
        // user may not be populated — load if needed
        let to = email;
        if (!to && (order as any)?.user) {
          const { User } = await import("@/models/User");
          const u = await User.findById((order as any).user)
            .select("email")
            .lean();
          to = u?.email;
        }
        if (order && to) {
          await sendShipmentTrackingEmail(String(to), order, {
            trackingNumber: nextTracking,
            trackingCarrier:
              extras?.trackingCarrier ||
              (existing as any).trackingCarrier ||
              "",
            poNumber: (existing as any).poNumber,
          });
          // Move customer order toward dispatched when tracking arrives
          if (
            ["Ordered from Supplier", "Awaiting Dispatch", "Processing"].includes(
              String((order as any).status),
            )
          ) {
            await Order.findByIdAndUpdate((order as any)._id, {
              status: "Dispatched",
            });
          }
        }
      } catch (mailErr) {
        console.error("Tracking email failed:", mailErr);
      }
    }

    revalidatePath("/admin/purchase-orders");
    revalidatePath("/admin/orders");
    return { success: true };
  } catch (error) {
    console.error("updatePurchaseOrderStatus:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function emailPurchaseOrderToSupplier(poId: string) {
  try {
    await connectDB();
    const po = await PurchaseOrder.findById(poId).populate(
      "supplier",
      "name email",
    );
    if (!po) return { success: false, error: "PO not found" };
    const email = (po as any).supplier?.email;
    if (!email) {
      return { success: false, error: "Supplier has no email address" };
    }
    await sendPurchaseOrderToSupplier(
      email,
      po.toObject(),
      (po as any).supplier?.name,
    );
    po.status = po.status === "Draft" ? "Submitted" : po.status;
    po.submittedAt = po.submittedAt || new Date();
    await po.save();
    revalidatePath("/admin/purchase-orders");
    return { success: true };
  } catch (error: any) {
    console.error("emailPurchaseOrderToSupplier:", error);
    return { success: false, error: error?.message || "Email failed" };
  }
}

/**
 * Build draft purchase order(s) from a customer order.
 * Groups line items by best/available supplier.
 */
export async function createPurchaseOrdersFromOrder(
  orderId: string,
  opts?: { autoEmailSuppliers?: boolean },
) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return { success: false, error: "Invalid order" };
    }

    const order = await Order.findById(orderId).lean();
    if (!order) return { success: false, error: "Order not found" };

    const existing = await PurchaseOrder.countDocuments({ order: orderId });
    if (existing > 0) {
      return {
        success: false,
        error: "Purchase order(s) already exist for this order",
      };
    }

    type Line = {
      supplierId: string;
      name: string;
      productId: string | null;
      supplierSku: string;
      quantity: number;
      unitCost: number;
      sellPrice: number;
    };
    const lines: Line[] = [];

    for (const item of (order as any).items || []) {
      const productId = String(item.product || "");
      let product: any = null;
      if (mongoose.Types.ObjectId.isValid(productId)) {
        product = await Product.findById(productId).lean();
      }

      let supplierId =
        product?.supplier != null ? String(product.supplier) : "";
      let unitCost = Number(product?.costPrice);
      let supplierSku = String(product?.supplierSku || "");
      let deliveryCost = Number(product?.deliveryCost) || 0;

      if (product) {
        const offers = await ProductSupplier.find({
          product: product._id,
          isActive: true,
        }).lean();
        if (offers.length) {
          const best = pickBestSupplierOffer(offers as any[]);
          if (best) {
            supplierId = String((best as any).supplier);
            unitCost = Number((best as any).costPrice);
            supplierSku = String((best as any).supplierSku || supplierSku);
            deliveryCost = Number((best as any).deliveryCost) || deliveryCost;
          }
        }
      }

      if (!supplierId) {
        continue;
      }

      lines.push({
        supplierId,
        name: String(item.name || product?.name || "Item"),
        productId: product?._id ? String(product._id) : null,
        supplierSku,
        quantity: Number(item.quantity) || 1,
        unitCost: Number.isFinite(unitCost) ? unitCost : 0,
        sellPrice: Number(item.price) || 0,
      });
    }

    if (!lines.length) {
      return {
        success: false,
        error:
          "No line items have a linked supplier. Assign suppliers on products first.",
      };
    }

    const bySupplier = new Map<string, Line[]>();
    for (const line of lines) {
      const arr = bySupplier.get(line.supplierId) || [];
      arr.push(line);
      bySupplier.set(line.supplierId, arr);
    }

    const created: any[] = [];
    for (const [supplierId, group] of bySupplier) {
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) continue;

      const items = group.map((g) => ({
        product: g.productId,
        name: g.name,
        supplierSku: g.supplierSku,
        quantity: g.quantity,
        unitCost: g.unitCost,
        lineTotal: Math.round(g.unitCost * g.quantity * 100) / 100,
      }));
      const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
      const expectedSell = group.reduce(
        (s, g) => s + g.sellPrice * g.quantity,
        0,
      );
      const margin =
        expectedSell > 0
          ? Math.round(((expectedSell - subtotal) / expectedSell) * 1000) / 10
          : null;

      const po = await PurchaseOrder.create({
        poNumber: await nextPoNumber(),
        supplier: supplierId,
        order: orderId,
        orderNumber: (order as any).orderNumber || "",
        status: "Draft",
        items,
        subtotal,
        deliveryCost: 0,
        totalCost: subtotal,
        expectedSellTotal: expectedSell,
        estimatedMarginPercent: margin,
        currency: supplier.currency || "GBP",
        notes: `Auto-created from customer order ${
          (order as any).orderNumber || orderId
        }`,
      });

      if (opts?.autoEmailSuppliers && supplier.email) {
        try {
          await sendPurchaseOrderToSupplier(
            supplier.email,
            po.toObject(),
            supplier.name,
          );
          po.status = "Submitted";
          po.submittedAt = new Date();
          po.lastError = null;
          await po.save();
        } catch (mailErr: any) {
          po.lastError = mailErr?.message || "Supplier email failed";
          await po.save();
          console.error("PO email failed:", mailErr);
        }
      }

      created.push(po);
    }

    if (created.length) {
      await Order.findByIdAndUpdate(orderId, {
        status: "Ordered from Supplier",
      });
    }

    revalidatePath("/admin/purchase-orders");
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");

    return {
      success: true,
      count: created.length,
      purchaseOrders: JSON.parse(JSON.stringify(created)),
    };
  } catch (error) {
    console.error("createPurchaseOrdersFromOrder:", error);
    return { success: false, error: "Failed to create purchase orders" };
  }
}
