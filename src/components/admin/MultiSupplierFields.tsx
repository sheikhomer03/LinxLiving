"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Star } from "lucide-react";
import { toast } from "sonner";
import {
  getProductSuppliers,
  upsertProductSupplier,
  deleteProductSupplier,
  applyBestSupplierToProduct,
} from "@/app/actions/productSuppliers";

type Offer = {
  _id: string;
  supplier: { _id: string; name: string } | string;
  supplierSku?: string;
  costPrice?: number | null;
  deliveryCost?: number | null;
  stock?: number;
  leadTimeDays?: number | null;
  priority?: number;
  isPreferred?: boolean;
  isActive?: boolean;
};

export function MultiSupplierFields({
  productId,
  suppliers,
}: {
  productId: string;
  suppliers: { _id: string; name: string }[];
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplierId: "",
    supplierSku: "",
    costPrice: "",
    deliveryCost: "",
    stock: "0",
    leadTimeDays: "",
    priority: "100",
    isPreferred: false,
  });

  const load = async () => {
    setLoading(true);
    const res = await getProductSuppliers(productId);
    if (res.success) setOffers(res.offers as Offer[]);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (productId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const save = async () => {
    if (!form.supplierId) {
      toast.error("Select a supplier");
      return;
    }
    setSaving(true);
    const res = await upsertProductSupplier({
      productId,
      supplierId: form.supplierId,
      supplierSku: form.supplierSku,
      costPrice: form.costPrice === "" ? null : Number(form.costPrice),
      deliveryCost:
        form.deliveryCost === "" ? null : Number(form.deliveryCost),
      stock: Number(form.stock) || 0,
      leadTimeDays:
        form.leadTimeDays === "" ? null : Number(form.leadTimeDays),
      priority: Number(form.priority) || 100,
      isPreferred: form.isPreferred,
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success("Supplier offer saved");
    setForm({
      supplierId: "",
      supplierSku: "",
      costPrice: "",
      deliveryCost: "",
      stock: "0",
      leadTimeDays: "",
      priority: "100",
      isPreferred: false,
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this supplier offer?")) return;
    const res = await deleteProductSupplier(id);
    if (res.success) {
      toast.success("Removed");
      load();
    } else toast.error(res.error || "Failed");
  };

  const applyBest = async () => {
    const res = await applyBestSupplierToProduct(productId);
    if (res.success) {
      toast.success("Best supplier applied to product");
      load();
    } else toast.error(res.error || "Failed");
  };

  return (
    <div className="space-y-4 border-t border-stone-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] font-black text-stone-800">
            Multi-supplier offers
          </p>
          <p className="text-[11px] text-stone-500 mt-1">
            One product can have multiple suppliers. Best offer is chosen by
            stock, cost, delivery, lead time and priority.
          </p>
        </div>
        <button
          type="button"
          onClick={applyBest}
          className="text-[9px] uppercase tracking-widest font-bold border border-primary/30 px-3 py-1.5 text-primary hover:bg-primary/5"
        >
          Apply best → product
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary/40" />
      ) : offers.length === 0 ? (
        <p className="text-xs text-stone-400">No alternate suppliers yet.</p>
      ) : (
        <div className="divide-y divide-stone-100 border border-stone-200 bg-white">
          {offers.map((o) => {
            const name =
              typeof o.supplier === "object" ? o.supplier?.name : o.supplier;
            return (
              <div
                key={o._id}
                className="flex flex-wrap items-center gap-3 p-3 text-xs"
              >
                <div className="min-w-0 sm:min-w-35 font-bold text-stone-800 flex items-center gap-1">
                  {o.isPreferred ? (
                    <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                  ) : null}
                  {name}
                </div>
                <span className="text-stone-500">{o.supplierSku || "—"}</span>
                <span>
                  Cost £{o.costPrice != null ? Number(o.costPrice).toFixed(2) : "—"}
                </span>
                <span>Ship £{o.deliveryCost != null ? Number(o.deliveryCost).toFixed(2) : "—"}</span>
                <span>Stock {o.stock ?? 0}</span>
                <span>Lead {o.leadTimeDays ?? "—"}d</span>
                <span>P{o.priority ?? 100}</span>
                <button
                  type="button"
                  onClick={() => remove(o._id)}
                  className="ml-auto p-1 text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <select
          value={form.supplierId}
          onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
          className="col-span-2 bg-secondary/10 px-3 py-2 text-sm border-b border-stone-200 outline-none"
        >
          <option value="">Add supplier…</option>
          {suppliers.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Supplier SKU"
          value={form.supplierSku}
          onChange={(e) => setForm({ ...form, supplierSku: e.target.value })}
          className="bg-secondary/10 px-3 py-2 text-sm border-b border-stone-200 outline-none"
        />
        <input
          placeholder="Cost"
          type="number"
          step="0.01"
          value={form.costPrice}
          onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
          className="bg-secondary/10 px-3 py-2 text-sm border-b border-stone-200 outline-none"
        />
        <input
          placeholder="Delivery"
          type="number"
          step="0.01"
          value={form.deliveryCost}
          onChange={(e) => setForm({ ...form, deliveryCost: e.target.value })}
          className="bg-secondary/10 px-3 py-2 text-sm border-b border-stone-200 outline-none"
        />
        <input
          placeholder="Stock"
          type="number"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
          className="bg-secondary/10 px-3 py-2 text-sm border-b border-stone-200 outline-none"
        />
        <input
          placeholder="Lead days"
          type="number"
          value={form.leadTimeDays}
          onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
          className="bg-secondary/10 px-3 py-2 text-sm border-b border-stone-200 outline-none"
        />
        <label className="flex items-center gap-2 text-[11px] text-stone-600 px-1">
          <input
            type="checkbox"
            checked={form.isPreferred}
            onChange={(e) =>
              setForm({ ...form, isPreferred: e.target.checked })
            }
          />
          Preferred
        </label>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center justify-center gap-1 admin-btn-primary text-[9px] uppercase tracking-widest font-bold disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          Save offer
        </button>
      </div>
    </div>
  );
}
