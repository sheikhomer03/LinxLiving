/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Printer,
  Truck,
  CheckCircle2,
  Mail,
  MapPin,
  CreditCard,
  Box,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { useSingleOrder } from "@/hooks/useRealtimeOrders";
import { createPurchaseOrdersFromOrder } from "@/app/actions/purchaseOrders";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function OrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { order, loading, refresh } = useSingleOrder(id);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [isCreatingPo, setIsCreatingPo] = useState(false);

  const handleCreatePo = async () => {
    if (!order) return;
    setIsCreatingPo(true);
    try {
      const res = await createPurchaseOrdersFromOrder(order._id, {
        autoEmailSuppliers: true,
      });
      if (!res.success) {
        toast.error(res.error || "Could not create PO");
        return;
      }
      toast.success(
        `Created ${res.count} purchase order${res.count === 1 ? "" : "s"}`,
      );
      await refresh();
    } catch {
      toast.error("Could not create PO");
    } finally {
      setIsCreatingPo(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!order) return;
    setIsConfirmingPayment(true);
    try {
      const updatePromise = fetch(`/api/orders/${order._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: "Paid" }),
      }).then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to confirm payment");
        }
        return res.json();
      });

      toast.promise(updatePromise, {
        loading: "Confirming payment...",
        success: "Payment marked as paid",
        error: (err) => `Failed: ${err.message}`,
      });

      await updatePromise;
      await refresh();
    } catch (err) {
      console.error("Confirm Payment Error:", err);
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const handlePrintInvoice = () => {
    if (!order) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    // Header
    doc.setFontSize(40);
    doc.setTextColor(51, 51, 51);
    doc.text("LINX", 20, 30);
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text("LUXURY ARCHITECTURAL ELEMENTS", 20, 38);

    // Invoice Info (Right Aligned)
    doc.setTextColor(51, 51, 51);
    doc.setFontSize(22);
    doc.text("INVOICE", pageWidth - 20, 30, { align: "right" });
    doc.setFontSize(10);
    doc.text(`Order: #${order.orderNumber}`, pageWidth - 20, 40, {
      align: "right",
    });
    doc.text(
      `Date: ${new Date(order.createdAt).toLocaleDateString()}`,
      pageWidth - 20,
      45,
      { align: "right" },
    );

    // Horizontal Line
    doc.setDrawColor(240);
    doc.line(20, 60, pageWidth - 20, 60);

    // Billing / Shipping Info
    doc.setFontSize(12);
    doc.text("BILLED TO", 20, 80);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(
      `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
      20,
      88,
    );
    doc.text(order.shippingAddress.email || "", 20, 93);
    doc.text(order.shippingAddress.phone || "", 20, 98);
    doc.text(order.shippingAddress.address, 20, 103);
    doc.text(
      `${order.shippingAddress.city}, ${order.shippingAddress.postcode}`,
      20,
      103,
    );
    doc.text(order.shippingAddress.country, 20, 108);

    // Payment Info (Right Aligned)
    doc.setTextColor(51, 51, 51);
    doc.setFontSize(12);
    doc.text("PAYMENT", pageWidth - 20, 80, { align: "right" });
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(order.paymentMethod, pageWidth - 20, 88, { align: "right" });
    doc.text(`Status: ${order.paymentStatus}`, pageWidth - 20, 93, {
      align: "right",
    });

    // Items Table
    const tableData = order.items.map((item: any) => [
      item.name.toUpperCase(),
      item.quantity.toString(),
      `£${item.price.toFixed(2)}`,
      `£${(item.price * item.quantity).toFixed(2)}`,
    ]);

    autoTable(doc, {
      startY: 125,
      head: [["PIECE", "QTY", "PRICE", "TOTAL"]],
      body: tableData,
      theme: "plain",
      headStyles: {
        fillColor: [51, 51, 51],
        textColor: [255, 255, 255],
        fontSize: 9,
        cellPadding: 6,
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 6,
        textColor: [51, 51, 51],
      },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { halign: "center", cellWidth: 20 },
        2: { halign: "right", cellWidth: 30 },
        3: { halign: "right", cellWidth: 30 },
      },
    });

    // Totals
    const finalY = (doc as any).lastAutoTable.finalY + 20;
    const subtotal = order.items.reduce(
      (acc: number, item: any) => acc + item.price * item.quantity,
      0,
    );
    const shippingCost =
      order.shippingMethod && order.shippingMethod === "Express Courier"
        ? 12
        : 0;

    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text("SUBTOTAL", pageWidth - 60, finalY, { align: "right" });
    doc.setTextColor(51, 51, 51);
    doc.text(`£${subtotal.toFixed(2)}`, pageWidth - 20, finalY, {
      align: "right",
    });

    let currentY = finalY + 8;
    if (order.discountAmount && order.discountAmount > 0) {
      doc.setTextColor(150);
      doc.text(
        `DISCOUNT (${order.couponCode || "COUPON"})`,
        pageWidth - 60,
        currentY,
        { align: "right" },
      );
      doc.setTextColor(51, 51, 51);
      doc.text(
        `-£${order.discountAmount.toFixed(2)}`,
        pageWidth - 20,
        currentY,
        {
          align: "right",
        },
      );
      currentY += 8;
    }

    doc.setTextColor(150);
    doc.text("SHIPPING", pageWidth - 60, currentY, { align: "right" });
    doc.setTextColor(51, 51, 51);
    doc.text(`£${shippingCost.toFixed(2)}`, pageWidth - 20, currentY, {
      align: "right",
    });

    doc.setFontSize(14);
    doc.text("TOTAL DUE", pageWidth - 60, currentY + 14, { align: "right" });
    doc.text(
      `£${order.totalAmount.toFixed(2)}`,
      pageWidth - 20,
      currentY + 14,
      {
        align: "right",
      },
    );

    // Footer
    doc.setFontSize(9);
    doc.setTextColor(200);
    doc.text(
      "Thank you for curating with LINX. This is a computer-generated invoice.",
      pageWidth / 2,
      doc.internal.pageSize.height - 20,
      { align: "center" },
    );

    doc.save(`Invoice_${order.orderNumber}.pdf`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-4">
        <h1 className="text-lg font-serif uppercase tracking-widest text-primary">
          Order Not Found
        </h1>
        <Link
          href="/admin/orders"
          className="text-xs uppercase tracking-widest font-bold underline"
        >
          Back to Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8 px-4 sm:px-0 max-w-7xl mx-auto">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-3 lg:space-y-4">
          <Link
            href="/admin/orders"
            className="flex items-center gap-2 text-[9px] lg:text-[10px] uppercase tracking-widest font-bold text-primary/80 hover:text-primary transition-all"
          >
            <ChevronLeft className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
            Back to Orders
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 lg:gap-4">
            <h1 className="text-xl font-serif uppercase tracking-[0.15em] lg:tracking-[0.12em] text-primary">
              Order #{order.orderNumber}
            </h1>
            <div className="relative group/status">
              <select
                value={order.status}
                disabled={isUpdating}
                onChange={async (e) => {
                  const newStatus = e.target.value;
                  setIsUpdating(true);
                  try {
                    const updatePromise = fetch(`/api/orders/${order._id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: newStatus }),
                    }).then(async (res) => {
                      if (!res.ok) {
                        const errorData = await res.json().catch(() => ({}));
                        throw new Error(
                          errorData.error || "Failed to update status",
                        );
                      }
                      return res.json();
                    });

                    toast.promise(updatePromise, {
                      loading: "Updating order status...",
                      success: `Order status updated to ${newStatus}`,
                      error: (err) => `Failed: ${err.message}`,
                    });

                    await updatePromise;
                    await refresh();
                  } catch (err) {
                    console.error("Status Update Error:", err);
                  } finally {
                    setIsUpdating(false);
                  }
                }}
                className={cn(
                  "appearance-none text-[9px] lg:text-[10px] px-6 lg:px-4 py-2 border font-bold uppercase tracking-widest cursor-pointer outline-none transition-all disabled:opacity-80 disabled:cursor-not-allowed",
                  order.status === "Processing"
                    ? "bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100"
                    : order.status === "Confirmed Order"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100"
                    : order.status === "Shipped" ||
                        order.status === "Out for Delivery"
                      ? "bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100"
                      : order.status === "Delivered"
                        ? "bg-green-50 text-green-700 border-green-100 hover:bg-green-100"
                        : "bg-red-50 text-red-700 border-red-100 hover:bg-red-100",
                )}
              >
                <option value="Pending">Pending</option>
                <option value="Processing">Processing</option>
                <option value="Confirmed Order">Confirmed Order</option>
                <option value="Ordered from Supplier">
                  Ordered from Supplier
                </option>
                <option value="Awaiting Dispatch">Awaiting Dispatch</option>
                <option value="Dispatched">Dispatched</option>
                <option value="Shipped">Shipped</option>
                <option value="Out for Delivery">Out for Delivery</option>
                <option value="Delivered">Delivered</option>
                <option value="Returned">Returned</option>
                <option value="Refunded">Refunded</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity">
                {isUpdating ? (
                  <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                ) : (
                  <ChevronLeft className="w-3 h-3 -rotate-90 text-primary/80" />
                )}
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCreatePo}
          disabled={isCreatingPo}
          className="border border-primary/20 px-6 lg:px-4 py-3 lg:py-4 uppercase tracking-[0.15em] lg:tracking-[0.12em] text-[9px] lg:text-[10px] font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-all flex items-center gap-2.5 lg:gap-3 w-fit disabled:opacity-60"
        >
          <Truck className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
          {isCreatingPo ? "Creating PO…" : "Create supplier PO"}
        </button>
        <button
          onClick={handlePrintInvoice}
          className="border border-primary/20 px-6 lg:px-4 py-3 lg:py-4 uppercase tracking-[0.15em] lg:tracking-[0.12em] text-[9px] lg:text-[10px] font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-all flex items-center gap-2.5 lg:gap-3 w-fit"
        >
          <Printer className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
          Print Invoice
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-10">
        {/* Main Content: Items & Timeline */}
        <div className="lg:col-span-2 space-y-5">
          {/* Order Items */}
          <div className="bg-white border border-stone-200/80 overflow-hidden shadow-sm">
            <div className="p-4 sm:p-5 border-b border-primary/10">
              <h2 className="text-lg lg:text-xl font-serif uppercase tracking-widest text-primary">
                Order Pieces
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="admin-responsive-table w-full text-left border-collapse">
                <thead>
                  <tr className="admin-table-head border-b border-primary/10">
                    <th className="px-4 py-2 text-[9px] uppercase tracking-[0.12em] font-bold text-primary">
                      Piece
                    </th>
                    <th className="px-4 py-2 text-[9px] uppercase tracking-[0.12em] font-bold text-primary text-center">
                      Qty
                    </th>
                    <th className="px-4 py-2 text-[9px] uppercase tracking-[0.12em] font-bold text-primary text-right">
                      Price
                    </th>
                    <th className="px-4 py-2 text-[9px] uppercase tracking-[0.12em] font-bold text-primary text-right">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {order.items.map((item, i) => (
                    <tr
                      key={i}
                      className="hover:bg-secondary/5 transition-colors"
                    >
                      <td data-label="Piece" className="px-4 py-2.5">
                        <div className="flex items-center gap-4">
                          <div className="relative w-12 h-12 bg-secondary/50 border border-stone-200/80">
                            <Image
                              src={item.image}
                              alt={item.name}
                              fill
                              className="object-cover grayscale"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] uppercase tracking-widest font-bold text-stone-800">
                              {item.name}
                            </span>
                            {item.brandName ? (
                              <span className="text-[9px] uppercase tracking-widest text-stone-500">
                                Supplier: {item.brandName}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td data-label="Qty" className="px-4 py-2.5 text-center font-serif text-sm">
                        {item.quantity}
                      </td>
                      <td data-label="Price" className="px-4 py-2.5 text-right font-serif text-sm">
                        £{item.price.toFixed(2)}
                      </td>
                      <td data-label="Total" className="px-4 py-2.5 text-right font-serif text-sm font-bold">
                        £{(item.price * item.quantity).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total Summary */}
            <div className="p-10 bg-secondary/10 flex justify-end">
              <div className="w-72 space-y-4">
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-80">
                  <span>Subtotal</span>
                  <span>
                    £
                    {order.items
                      .reduce(
                        (acc: any, item: any) =>
                          acc + item.price * item.quantity,
                        0,
                      )
                      .toFixed(2)}
                  </span>
                </div>
                {order.discountAmount && order.discountAmount > 0 && (
                  <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold text-green-700">
                    <span>Discount ({order.couponCode})</span>
                    <span>-£{order.discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold opacity-80">
                  <span>Shipping ({order.shippingMethod || "Standard"})</span>
                  <span>
                    £
                    {(order.shippingMethod &&
                    order.shippingMethod === "Express Courier"
                      ? 12
                      : 0
                    ).toFixed(2)}
                  </span>
                </div>
                <div className="pt-4 border-t border-primary/10 flex justify-between">
                  <span className="text-xs uppercase tracking-[0.12em] font-black text-primary">
                    Total Amount
                  </span>
                  <span className="text-lg lg:text-xl font-serif text-primary">
                    £{order.totalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Logistics Tracking (Timeline) */}
          <div className="bg-white border border-primary/5 p-4 sm:p-5 space-y-6 lg:space-y-5 shadow-sm">
            <h3 className="text-[10px] lg:text-sm font-bold uppercase tracking-[0.12em] lg:tracking-widest text-primary flex items-center gap-3">
              <Truck className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-primary" />
              Logistics Journey
            </h3>
            <div className="space-y-6 lg:space-y-5">
              {[
                {
                  label: "Order Placed",
                  date: new Date(order.createdAt).toLocaleString(),
                  status: "complete",
                  icon: CheckCircle2,
                },
                {
                  label: "Payment Verified",
                  date: order.paymentStatus === "Paid" ? "Verified" : "Pending",
                  status:
                    order.paymentStatus === "Paid" ? "complete" : "current",
                  icon: CreditCard,
                },
                {
                  label: "Preparing Pieces",
                  date:
                    order.status === "Processing"
                      ? "In Progress"
                      : order.status === "Shipped" ||
                          order.status === "Out for Delivery" ||
                          order.status === "Delivered"
                        ? "Completed"
                        : "Pending",
                  status:
                    order.status === "Processing"
                      ? "current"
                      : order.status === "Shipped" ||
                          order.status === "Out for Delivery" ||
                          order.status === "Delivered"
                        ? "complete"
                        : "pending",
                  icon: Box,
                },
                {
                  label: "Out for Delivery",
                  date:
                    order.status === "Shipped" ||
                    order.status === "Out for Delivery"
                      ? "In Transit"
                      : order.status === "Delivered"
                        ? "Arrived"
                        : "Pending",
                  status:
                    order.status === "Out for Delivery"
                      ? "current"
                      : order.status === "Delivered"
                        ? "complete"
                        : "pending",
                  icon: Truck,
                },
              ].map((step, i) => (
                <div key={i} className="flex gap-6 relative group">
                  {i !== 3 && (
                    <div className="absolute left-2.75 top-6 w-px h-10 bg-primary/10" />
                  )}
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10",
                      step.status === "complete"
                        ? "bg-primary/10"
                        : step.status === "current"
                          ? "bg-amber-50"
                          : "bg-secondary/20",
                    )}
                  >
                    <step.icon
                      className={cn(
                        "w-3.5 h-3.5",
                        step.status === "complete"
                          ? "text-primary"
                          : step.status === "current"
                            ? "text-amber-600"
                            : "text-stone-800/20",
                      )}
                    />
                  </div>
                  <div>
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-widest font-black",
                        step.status === "pending"
                          ? "opacity-60"
                          : "text-primary",
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="text-[9px] uppercase tracking-[0.12em] font-bold opacity-80 mt-1">
                      {step.date}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar: Customer & Payment */}
        <div className="space-y-5">
          {/* Customer Details */}
          <div className="bg-white border border-stone-200/80 p-4 sm:p-5 space-y-6 lg:space-y-5 shadow-sm">
            <h3 className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-black text-stone-800 opacity-80 pb-4 border-b border-stone-200/80">
              Customer Info
            </h3>
            <div className="space-y-5 lg:space-y-6">
              <div className="flex items-center gap-3 lg:gap-4">
                <div className="w-10 h-10 lg:w-12 lg:h-12 bg-primary text-primary-foreground flex items-center justify-center font-serif text-lg lg:text-xl shadow-sm shadow-primary/10">
                  {order.shippingAddress.firstName[0]}
                </div>
                <div>
                  <p className="text-[11px] lg:text-xs font-bold uppercase tracking-widest text-stone-800">
                    {order.shippingAddress.firstName}{" "}
                    {order.shippingAddress.lastName}
                  </p>
                  <p className="text-[8px] lg:text-[9px] opacity-60 uppercase tracking-widest mt-1 text-primary font-bold">
                    Authenticated Customer
                  </p>
                </div>
              </div>
              <div className="space-y-3 lg:space-y-4 pt-2 lg:pt-4">
                <div className="flex items-start gap-3 lg:gap-4">
                  <Mail className="w-3.5 h-3.5 lg:w-4 lg:h-4 opacity-90 mt-0.5" />
                  <span className="text-[11px] lg:text-[14px] font-bold text-stone-800 break-all">
                    {order.shippingAddress.email || "Email Not Provided"}
                  </span>
                </div>
                <div className="flex items-center gap-3 lg:gap-4">
                  <div className="w-3.5 h-3.5 lg:w-4 lg:h-4 opacity-90 flex items-center justify-center">
                    <svg
                      className="w-full h-full"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      ></path>
                    </svg>
                  </div>
                  <span className="text-[11px] lg:text-[14px] font-bold text-stone-800">
                    {order.shippingAddress.phone || "Phone Not Provided"}
                  </span>
                </div>
                <div className="flex items-start gap-3 lg:gap-4">
                  <MapPin className="w-3.5 h-3.5 lg:w-4 lg:h-4 opacity-90 mt-0.5" />
                  <div className="text-[11px] lg:text-[13px] font-bold text-stone-800 leading-relaxed">
                    {order.shippingAddress.address}
                    <br />
                    {order.shippingAddress.city},{" "}
                    {order.shippingAddress.postcode}
                    <br />
                    {order.shippingAddress.country}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Method */}
          <div className="bg-white border border-stone-200/80 p-4 sm:p-5 space-y-6 lg:space-y-5 shadow-sm">
            <h3 className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-black text-stone-800 opacity-80 pb-4 border-b border-stone-200/80">
              Payment & Bond
            </h3>
            <div className="flex items-center gap-3 lg:gap-4">
              <div className="p-2.5 lg:p-3 bg-secondary/50">
                <CreditCard className="w-4 h-4 lg:w-5 lg:h-5 text-stone-400" />
              </div>
              <div>
                <p className="text-[9px] lg:text-[10px] uppercase tracking-widest font-black text-stone-800">
                  {order.paymentMethod}
                </p>
                <p
                  className={`text-[8px] lg:text-[9px] uppercase tracking-widest font-bold mt-1 ${order.paymentStatus === "Paid" ? "text-green-600" : "text-amber-600"}`}
                >
                  {order.paymentStatus === "Paid"
                    ? "Captured Successfully"
                    : order.paymentStatus === "Failed"
                      ? "Payment Failed"
                      : "Payment Pending"}
                </p>
              </div>
            </div>
            {order.paymentStatus !== "Paid" && (
              <button
                type="button"
                onClick={handleConfirmPayment}
                disabled={isConfirmingPayment}
                className="w-full admin-btn-primary rounded-lg py-2 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2 border border-primary/20"
              >
                {isConfirmingPayment ? "Confirming…" : "Confirm Payment"}
              </button>
            )}
          </div>

          {/* Admin Notes */}
          {/* <div className="bg-white border border-stone-200/80 p-4 sm:p-5 space-y-4 lg:space-y-6 shadow-sm">
            <h3 className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-black text-stone-800 opacity-80">
              Curation Notes
            </h3>
            <textarea
              placeholder="ADD A NOTE FOR YOUR TEAM..."
              className="w-full bg-secondary/10 border-none p-5 lg:p-6 text-[9px] lg:text-[10px] uppercase tracking-widest font-bold min-h-[100px] lg:min-h-[120px] outline-none focus:bg-white focus:ring-1 focus:ring-stone-200 transition-all"
            />
            <button className="w-full admin-btn-primary rounded-lg py-2 text-[8px] lg:text-[9px] uppercase tracking-[0.12em] lg:tracking-widest font-bold hover:opacity-90 transition-all">
              Save Note
            </button>
          </div> */}
        </div>
      </div>
    </div>
  );
}
