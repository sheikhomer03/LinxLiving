"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronRight,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Search,
  ImagePlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  importSupplierCostCsv,
} from "@/app/actions/suppliers";
import { SupplierContactButtons } from "@/components/suppliers/SupplierContactButtons";
import { cn } from "@/lib/utils";

const emptyForm = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  whatsapp: "",
  website: "",
  address: "",
  notes: "",
  order: 0,
  defaultLeadTimeDays: "",
  isActive: true,
};

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState(emptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [existingLogo, setExistingLogo] = useState("");
  const [removeLogo, setRemoveLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvSupplierId, setCsvSupplierId] = useState("");
  const [csvApplyMargin, setCsvApplyMargin] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);

  const load = async () => {
    setIsLoading(true);
    const result = await getSuppliers();
    if (result.success) setSuppliers(result.suppliers);
    else toast.error("Failed to load suppliers");
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetLogo = () => {
    setLogoFile(null);
    setLogoPreview("");
    setExistingLogo("");
    setRemoveLogo(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openAdd = () => {
    setEditing(null);
    setFormData(emptyForm);
    resetLogo();
    setIsModalOpen(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setFormData({
      name: s.name || "",
      contactName: s.contactName || "",
      email: s.email || "",
      phone: s.phone || "",
      whatsapp: s.whatsapp || "",
      website: s.website || "",
      address: s.address || "",
      notes: s.notes || "",
      order: s.order ?? 0,
      defaultLeadTimeDays:
        s.defaultLeadTimeDays != null ? String(s.defaultLeadTimeDays) : "",
      isActive: s.isActive !== false,
    });
    setLogoFile(null);
    setLogoPreview("");
    setExistingLogo(s.logo || "");
    setRemoveLogo(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      let logoUrl = existingLogo;
      if (logoFile) {
        const uploadFd = new FormData();
        uploadFd.append("file", logoFile);
        const uploadRes = await fetch("/api/admin/upload", {
          method: "POST",
          body: uploadFd,
        });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok || !uploadJson.url) {
          throw new Error(uploadJson.error || "Logo upload failed");
        }
        logoUrl = uploadJson.url;
      }

      const fd = new FormData();
      fd.append("name", formData.name);
      fd.append(
        "slug",
        formData.name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      );
      fd.append("contactName", formData.contactName);
      fd.append("email", formData.email);
      fd.append("phone", formData.phone);
      fd.append("whatsapp", formData.whatsapp || formData.phone);
      fd.append("website", formData.website);
      fd.append("address", formData.address);
      fd.append("notes", formData.notes);
      fd.append("order", String(formData.order));
      fd.append("defaultLeadTimeDays", formData.defaultLeadTimeDays);
      fd.append("isActive", formData.isActive ? "true" : "false");
      if (removeLogo) {
        fd.append("removeLogo", "true");
        fd.append("logoUrl", "");
      } else {
        fd.append("logoUrl", logoUrl || "");
      }

      const result = editing
        ? await updateSupplier(editing._id, fd)
        : await createSupplier(fd);

      if (result.success) {
        toast.success(`Supplier ${editing ? "updated" : "created"}`);
        setIsModalOpen(false);
        load();
      } else {
        toast.error(result.error || "Action failed");
      }
    } catch (err: any) {
      toast.error(err?.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    const result = await deleteSupplier(id);
    if (result.success) {
      toast.success("Supplier deleted");
      load();
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const filtered = suppliers.filter((s) =>
    `${s.name} ${s.email} ${s.phone}`.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const displayLogo = logoPreview || (!removeLogo ? existingLogo : "");

  const handleCsvImport = async () => {
    const file = csvInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file first");
      return;
    }
    setCsvImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (csvSupplierId) fd.append("supplierId", csvSupplierId);
      if (csvApplyMargin) fd.append("applyMargin", "true");
      const result = await importSupplierCostCsv(fd);
      if (!result.success) {
        toast.error(result.error || "Import failed");
        return;
      }
      const errHint =
        result.errors?.length
          ? ` · ${result.errors.slice(0, 3).join("; ")}`
          : "";
      toast.success(
        `Updated ${result.updated} of ${result.total} rows (${result.skipped} skipped)${errHint}`,
      );
      if (csvInputRef.current) csvInputRef.current.value = "";
    } catch {
      toast.error("Import failed");
    } finally {
      setCsvImporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Suppliers</span>
      </nav>

      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Suppliers
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
            Contact cards with WhatsApp, email and website shortcuts
          </p>
        </div>
        <button
          onClick={openAdd}
          className="w-full sm:w-auto admin-btn-primary inline-flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
            Add Supplier
          </span>
        </button>
      </header>

      <div className="admin-search flex items-center gap-3">
        <Search className="w-4 h-4 text-primary shrink-0" />
        <input
          type="search"
          placeholder="Search suppliers..."
          className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white admin-panel-elevated p-4 sm:p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-[11px] uppercase tracking-[0.14em] font-black text-stone-800">
            Import costs / stock CSV
          </h2>
          <p className="text-[11px] text-stone-500 leading-relaxed">
            Columns: sku | supplierSku | productId | costPrice | marginPercent |
            leadTimeDays | stock | applyMargin. Match by productId, then
            supplierSku, then specs.sku.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-end">
          <label className="space-y-1 min-w-[180px] flex-1">
            <span className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
              Assign supplier (optional)
            </span>
            <select
              value={csvSupplierId}
              onChange={(e) => setCsvSupplierId(e.target.value)}
              className="w-full border border-stone-200 bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-primary/40"
            >
              <option value="">— None —</option>
              {suppliers.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 flex-1 min-w-[200px]">
            <span className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
              CSV file
            </span>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="w-full text-sm file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-[10px] file:uppercase file:tracking-widest file:font-bold"
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={csvApplyMargin}
              onChange={(e) => setCsvApplyMargin(e.target.checked)}
              className="accent-primary"
            />
            Apply margin → sell price
          </label>
          <button
            type="button"
            onClick={handleCsvImport}
            disabled={csvImporting}
            className="admin-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {csvImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              {csvImporting ? "Importing…" : "Import CSV"}
            </span>
          </button>
        </div>
      </div>

      <div className="bg-white admin-panel-elevated overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <p className="text-stone-400 uppercase tracking-widest text-[11px] font-bold">
              No suppliers yet.
            </p>
            <button
              onClick={openAdd}
              className="text-primary text-[10px] uppercase tracking-widest font-bold hover:underline"
            >
              Add Spectra or another supplier
            </button>
          </div>
        ) : (
          <div className="divide-y divide-primary/5">
            {filtered.map((s) => (
              <div
                key={s._id}
                className="p-4 sm:p-5 hover:bg-secondary/40 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="relative w-14 h-14 shrink-0 overflow-hidden bg-secondary border border-stone-200">
                      {s.logo ? (
                        <Image
                          src={s.logo}
                          alt={s.name}
                          fill
                          className="object-contain p-1"
                          sizes="56px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-stone-400">
                          {s.name?.charAt(0) || "?"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] uppercase tracking-[0.12em] font-black text-stone-800">
                          {s.name}
                        </p>
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 text-[8px] uppercase tracking-[0.12em] font-bold",
                            s.isActive !== false
                              ? "bg-green-50 text-green-700"
                              : "bg-secondary text-stone-500",
                          )}
                        >
                          {s.isActive !== false ? "Active" : "Inactive"}
                        </span>
                      </div>
                      {s.contactName ? (
                        <p className="text-xs text-stone-600 mt-0.5">
                          {s.contactName}
                        </p>
                      ) : null}
                      <p className="text-[10px] text-stone-500 mt-1 tracking-wide">
                        {[s.email, s.phone || s.whatsapp, s.website]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </p>
                      {s.address ? (
                        <p className="text-[11px] text-stone-500 mt-1">
                          {s.address}
                        </p>
                      ) : null}
                      <div className="mt-3">
                        <SupplierContactButtons supplier={s} size="sm" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      className="p-2 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s._id)}
                      className="p-2 hover:bg-red-50 text-red-600 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center admin-modal-overlay p-4">
          <div className="bg-white w-full max-w-xl p-4 sm:p-5 border border-primary/10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-serif uppercase tracking-widest text-stone-800 mb-4">
              {editing ? "Edit Supplier" : "Add Supplier"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {(
                [
                  ["name", "Supplier name", "e.g. Spectra", true],
                  ["contactName", "Contact person", "Optional", false],
                  ["email", "Email", "sales@example.com", false],
                  ["phone", "Phone", "+44…", false],
                  ["whatsapp", "WhatsApp number", "Defaults to phone", false],
                  ["website", "Website", "https://…", false],
                ] as const
              ).map(([key, label, placeholder, required]) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    {label}
                  </label>
                  <input
                    type={key === "email" ? "email" : "text"}
                    required={required}
                    value={(formData as any)[key]}
                    onChange={(e) =>
                      setFormData({ ...formData, [key]: e.target.value })
                    }
                    className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20"
                    placeholder={placeholder}
                  />
                </div>
              ))}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Address
                </label>
                <textarea
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                  rows={2}
                  className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={2}
                  className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    Default lead time (days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formData.defaultLeadTimeDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        defaultLeadTimeDays: e.target.value,
                      })
                    }
                    className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    List order
                  </label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        order: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Logo
                </label>
                {displayLogo ? (
                  <div className="relative w-28 h-20 border border-stone-200 bg-secondary/20">
                    <Image
                      src={displayLogo}
                      alt="Logo"
                      fill
                      className="object-contain p-2"
                      unoptimized={Boolean(logoPreview)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setLogoFile(null);
                        setLogoPreview("");
                        if (existingLogo) setRemoveLogo(true);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="absolute top-1 right-1 bg-white p-1 text-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-20 border border-dashed border-stone-200 flex items-center justify-center gap-2 text-stone-500"
                  >
                    <ImagePlus className="w-5 h-5" />
                    <span className="text-[10px] uppercase font-bold tracking-widest">
                      Upload logo
                    </span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setLogoFile(file);
                    setRemoveLogo(false);
                    setLogoPreview(URL.createObjectURL(file));
                  }}
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) =>
                    setFormData({ ...formData, isActive: e.target.checked })
                  }
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-70">
                  Active
                </span>
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 admin-btn-primary rounded-lg py-2.5 text-[10px] uppercase tracking-[0.16em] font-bold flex items-center justify-center gap-2"
                >
                  {isSubmitting && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {editing ? "Update Supplier" : "Create Supplier"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 bg-white text-stone-800 py-2.5 text-[10px] uppercase tracking-[0.16em] font-bold border border-stone-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
