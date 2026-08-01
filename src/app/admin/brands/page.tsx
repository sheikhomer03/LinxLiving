"use client";

import React, { useState, useEffect, useRef } from "react";
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
  getBrands,
  createBrand,
  updateBrand,
  deleteBrand,
} from "@/app/actions/admin";
import { getActiveSuppliers } from "@/app/actions/suppliers";
import { cn } from "@/lib/utils";
import { notifyCatalogChange } from "@/lib/live-sync";
import { useShopifyAutoSyncListener } from "@/components/admin/ShopifyAdminAutoSync";

export default function BrandsPage() {
  const [brands, setBrands] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    order: 0,
    isActive: true,
    supplier: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [existingImageUrl, setExistingImageUrl] = useState<string>("");
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBrands = async () => {
    setIsLoading(true);
    const [result, suppliersRes] = await Promise.all([
      getBrands(),
      getActiveSuppliers(),
    ]);
    if (result.success) {
      setBrands(result.brands);
    } else {
      toast.error("Failed to load brands");
    }
    if (suppliersRes.success) setSuppliers(suppliersRes.suppliers);
    setIsLoading(false);
  };

  useEffect(() => {
    loadBrands();
  }, []);

  useShopifyAutoSyncListener(() => {
    getBrands().then((result) => {
      if (result.success) setBrands(result.brands);
    });
  });

  const resetImageState = () => {
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl("");
    setRemoveImage(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    setImageFile(file);
    setRemoveImage(false);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearSelectedImage = () => {
    setImageFile(null);
    setImagePreview("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (existingImageUrl) {
      setRemoveImage(true);
    }
  };

  const openAddModal = () => {
    setEditingBrand(null);
    setFormData({ name: "", order: 0, isActive: true, supplier: "" });
    resetImageState();
    setIsModalOpen(true);
  };

  const openEditModal = (brand: any) => {
    setEditingBrand(brand);
    const supplierId =
      brand.supplier && typeof brand.supplier === "object"
        ? String(brand.supplier._id || "")
        : String(brand.supplier || "");
    setFormData({
      name: brand.name,
      order: brand.order ?? 0,
      isActive: brand.isActive !== false,
      supplier: supplierId,
    });
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl(brand.image || "");
    setRemoveImage(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let uploadedImageUrl = existingImageUrl;

      if (imageFile) {
        const uploadFd = new FormData();
        uploadFd.append("file", imageFile);
        const uploadRes = await fetch("/api/admin/upload", {
          method: "POST",
          body: uploadFd,
        });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok || !uploadJson.url) {
          throw new Error(uploadJson.error || "Image upload failed");
        }
        uploadedImageUrl = uploadJson.url;
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
      fd.append("order", formData.order.toString());
      fd.append("isActive", formData.isActive ? "true" : "false");
      fd.append("supplier", formData.supplier || "");

      if (removeImage) {
        fd.append("removeImage", "true");
        fd.append("imageUrl", "");
      } else {
        fd.append("imageUrl", uploadedImageUrl || "");
      }

      const result = editingBrand
        ? await updateBrand(editingBrand._id, fd)
        : await createBrand(fd);

      if (result.success) {
        toast.success(`Brand ${editingBrand ? "updated" : "created"} successfully`);
        setIsModalOpen(false);
        loadBrands();
        notifyCatalogChange("brands");
      } else {
        toast.error(result.error || "Action failed");
      }
    } catch (error: any) {
      toast.error(error?.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this brand? Menus must be reassigned first.")) return;

    const result = await deleteBrand(id);
    if (result.success) {
      toast.success("Brand deleted successfully");
      loadBrands();
      notifyCatalogChange("brands");
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const filteredBrands = brands.filter((brand) =>
    brand.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const displayPreview = imagePreview || (!removeImage ? existingImageUrl : "");

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Brands</span>
      </nav>

      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Brands
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
            Manage navbar brand dropdowns and menu groupings
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="w-full sm:w-auto admin-btn-primary inline-flex items-center justify-center gap-2 group"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              Add Brand
            </span>
          </div>

        </button>
      </header>

      <div className="admin-search flex items-center gap-3">
        <Search className="w-4 h-4 text-primary shrink-0" />
        <input
          type="search"
          placeholder="Search brands..."
          className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none transition-all"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white admin-panel-elevated overflow-hidden font-sans">
        <div className="admin-table-head font-semibold tracking-[0.12em] py-2.5 px-4 grid grid-cols-[1fr_88px_100px_120px] lg:grid-cols-[1fr_120px_100px_140px] gap-4 items-center">
          <span>Brand</span>
          <span className="text-center">Cover</span>
          <span className="text-center">Status</span>
          <span className="text-right">Actions</span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">
              Loading brands...
            </p>
          </div>
        ) : filteredBrands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <p className="text-stone-400 uppercase tracking-widest text-[11px] font-bold">
              No brands created yet.
            </p>
            <button
              onClick={openAddModal}
              className="text-primary text-[10px] uppercase tracking-widest font-bold hover:underline"
            >
              Add your first brand
            </button>
          </div>
        ) : (
          <div className="divide-y divide-primary/5">
            {filteredBrands.map((brand) => (
              <div
                key={brand._id}
                className="grid grid-cols-[1fr_88px_100px_120px] lg:grid-cols-[1fr_120px_100px_140px] gap-4 items-center py-4 px-4 hover:bg-secondary/50 transition-colors"
              >
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] font-black text-stone-800">
                    {brand.name}
                  </p>
                  <p className="text-[10px] text-stone-500 mt-1 tracking-wide">
                    /{brand.slug} · navbar position {brand.order ?? 0}
                    {brand.supplier?.name
                      ? ` · supplier ${brand.supplier.name}`
                      : ""}
                  </p>
                </div>
                <div className="flex justify-center">
                  {brand.image ? (
                    <div className="relative w-14 h-10 overflow-hidden bg-secondary border border-stone-200">
                      <Image
                        src={brand.image}
                        alt={brand.name}
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    </div>
                  ) : (
                    <div className="w-14 h-10 bg-secondary/40 border border-dashed border-stone-200 flex items-center justify-center">
                      <span className="text-[8px] uppercase tracking-wider text-stone-400 font-bold">
                        None
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <span
                    className={cn(
                      "inline-flex px-3 py-1 text-[9px] uppercase tracking-[0.12em] font-bold",
                      brand.isActive !== false
                        ? "bg-green-50 text-green-700"
                        : "bg-secondary text-stone-500",
                    )}
                  >
                    {brand.isActive !== false ? "Active" : "Hidden"}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(brand)}
                    className="p-2 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(brand._id)}
                    className="p-2 hover:bg-red-50 text-red-600 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center admin-modal-overlay p-4">
          <div className="bg-white w-full max-w-lg p-4 sm:p-5 border border-primary/10 shadow-2xl animate-in fade-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-serif uppercase tracking-widest text-stone-800 mb-4">
              {editingBrand ? "Edit Brand" : "Add Brand"}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Brand Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 transition-all font-medium"
                  placeholder="E.G. LINX SQUARE"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Navbar Position
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
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 transition-all"
                />
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Controls the left-to-right order of this brand in the navbar.
                  Lower numbers appear first (0 = first).
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Default supplier
                </label>
                <select
                  value={formData.supplier}
                  onChange={(e) =>
                    setFormData({ ...formData, supplier: e.target.value })
                  }
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 transition-all"
                >
                  <option value="">None</option>
                  {suppliers.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Products under this brand inherit this supplier unless
                  overridden on the product.{" "}
                  <Link href="/admin/suppliers" className="text-primary underline">
                    Manage suppliers
                  </Link>
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Brand Cover Image
                </label>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Shown in the brand dropdown on the site. Uploaded to
                  Cloudinary.
                </p>

                {displayPreview ? (
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary/20 border border-stone-200">
                    <Image
                      src={displayPreview}
                      alt="Brand cover preview"
                      fill
                      className="object-cover"
                      unoptimized={Boolean(imagePreview)}
                    />
                    <button
                      type="button"
                      onClick={clearSelectedImage}
                      className="absolute top-3 right-3 bg-white/95 p-2 hover:bg-red-50 text-red-600 transition-colors"
                      title="Remove image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full aspect-[16/10] border border-dashed border-stone-200 hover:border-primary/40 bg-secondary/10 flex flex-col items-center justify-center gap-3 transition-colors"
                  >
                    <ImagePlus className="w-7 h-7 text-primary/50" />
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-stone-500">
                      Upload cover image
                    </span>
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                />

                {displayPreview && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[10px] uppercase tracking-[0.25em] font-bold text-primary hover:underline"
                  >
                    Replace image
                  </button>
                )}
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
                  Show in navbar
                </span>
              </label>

              <div className="flex gap-4 pt-6">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 admin-btn-primary rounded-lg py-2.5 text-[10px] uppercase tracking-[0.16em] font-bold hover:opacity-90 transition-all shadow-sm flex items-center justify-center gap-3"
                >
                  {isSubmitting && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                  {editingBrand ? "Update Brand" : "Create Brand"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 bg-white text-stone-800 py-2.5 text-[10px] uppercase tracking-[0.16em] font-bold border border-stone-200 hover:bg-secondary/30 transition-all"
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
