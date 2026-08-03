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
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  getCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  getProducts,
} from "@/app/actions/admin";
import { cn } from "@/lib/utils";
import { getProductDisplayImage } from "@/lib/productImage";
import { notifyCatalogChange } from "@/lib/live-sync";
import { useShopifyAutoSyncListener } from "@/components/admin/ShopifyAdminAutoSync";

export default function CollectionsPage() {
  const [collections, setCollections] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCollection, setEditingCollection] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    order: 0,
    isActive: true,
  });
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [existingImageUrl, setExistingImageUrl] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    setIsLoading(true);
    const [collectionResult, productResult] = await Promise.all([
      getCollections(),
      getProducts(1, 80),
    ]);
    if (collectionResult.success) {
      setCollections(collectionResult.collections);
    } else {
      toast.error("Failed to load collections");
    }
    setAllProducts(productResult.products || []);
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Server-side product search in the collection picker (full catalogue)
  useEffect(() => {
    if (!isModalOpen) return;
    const q = productSearch.trim();
    const t = setTimeout(async () => {
      const result = await getProducts(1, 80, q);
      setAllProducts(result.products || []);
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch, isModalOpen]);

  useShopifyAutoSyncListener(() => {
    getCollections().then((result) => {
      if (result.success) setCollections(result.collections);
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
    if (existingImageUrl) setRemoveImage(true);
  };

  const openAddModal = () => {
    setEditingCollection(null);
    setFormData({ name: "", description: "", order: 0, isActive: true });
    setSelectedProductIds([]);
    setProductSearch("");
    resetImageState();
    setIsModalOpen(true);
  };

  const openEditModal = (collection: any) => {
    setEditingCollection(collection);
    setFormData({
      name: collection.name,
      description: collection.description || "",
      order: collection.order ?? 0,
      isActive: collection.isActive !== false,
    });
    const selected = (collection.products || []).map((p: any) =>
      typeof p === "string" ? p : String(p._id),
    );
    setSelectedProductIds(selected);
    // Keep already-linked products visible even if they're outside the first page
    const linked = (collection.products || []).filter(
      (p: any) => p && typeof p === "object" && p._id,
    );
    if (linked.length) {
      setAllProducts((prev) => {
        const map = new Map(prev.map((p) => [String(p._id), p]));
        for (const p of linked) map.set(String(p._id), p);
        return [...map.values()];
      });
    }
    setProductSearch("");
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl(collection.image || "");
    setRemoveImage(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsModalOpen(true);
  };

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProductIds.length === 0) {
      toast.error("Select at least one product for this collection");
      return;
    }

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
      fd.append("description", formData.description);
      fd.append("order", formData.order.toString());
      fd.append("isActive", formData.isActive ? "true" : "false");
      fd.append("productIds", JSON.stringify(selectedProductIds));

      if (removeImage) {
        fd.append("removeImage", "true");
        fd.append("imageUrl", "");
      } else {
        fd.append("imageUrl", uploadedImageUrl || "");
      }

      const result = editingCollection
        ? await updateCollection(editingCollection._id, fd)
        : await createCollection(fd);

      if (result.success) {
        toast.success(
          `Collection ${editingCollection ? "updated" : "created"} successfully`,
        );
        setIsModalOpen(false);
        loadData();
        notifyCatalogChange("collections");
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
    if (!confirm("Delete this collection?")) return;
    const result = await deleteCollection(id);
    if (result.success) {
      toast.success("Collection deleted");
      loadData();
      notifyCatalogChange("collections");
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const filteredCollections = collections.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredProducts = allProducts;

  const displayPreview = imagePreview || (!removeImage ? existingImageUrl : "");

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Collections</span>
      </nav>

      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Collections
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
            Curate product groups for the homepage Collections tab
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="w-full sm:w-auto admin-btn-primary rounded-lg px-4 py-2 flex items-center justify-center gap-3 border border-primary/20"
        >
          <Plus className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
            Add Collection
          </span>
        </button>
      </header>

      <div className="bg-white input-standard px-6 py-3 flex items-center gap-4 shadow-sm border border-stone-200/80">
        <Search className="w-4 h-4 text-primary shrink-0" />
        <input
          type="search"
          placeholder="Search collections..."
          className="w-full bg-transparent outline-none font-serif"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white border border-stone-200/80 overflow-hidden">
        <div className="admin-table-head font-semibold text-[11px] uppercase tracking-[0.12em] py-2.5 px-4 grid grid-cols-[1fr_88px_100px_120px] gap-4">
          <span>Collection</span>
          <span className="text-center">Cover</span>
          <span className="text-center">Products</span>
          <span className="text-right">Actions</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
          </div>
        ) : filteredCollections.length === 0 ? (
          <div className="text-center py-12 text-[11px] uppercase tracking-widest font-bold text-stone-400">
            No collections yet
          </div>
        ) : (
          <div className="divide-y divide-primary/5">
            {filteredCollections.map((collection) => (
              <div
                key={collection._id}
                className="grid grid-cols-[1fr_88px_100px_120px] gap-4 items-center py-4 px-4 hover:bg-secondary/50"
              >
                <div>
                  <p className="text-[11px] uppercase tracking-[0.12em] font-black text-stone-800">
                    {collection.name}
                  </p>
                  <p className="text-[10px] text-stone-500 mt-1">
                    /collections/{collection.slug} · position {collection.order ?? 0}
                  </p>
                </div>
                <div className="flex justify-center">
                  {collection.image ? (
                    <div className="relative w-14 h-10 overflow-hidden bg-secondary border border-stone-200">
                      <Image
                        src={collection.image}
                        alt={collection.name}
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    </div>
                  ) : (
                    <span className="text-[8px] uppercase text-stone-400 font-bold">
                      None
                    </span>
                  )}
                </div>
                <div className="text-center text-[10px] uppercase tracking-widest font-bold text-stone-500">
                  {(collection.products || []).length}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(collection)}
                    className="p-2 hover:bg-blue-50 text-blue-600 rounded"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(collection._id)}
                    className="p-2 hover:bg-red-50 text-red-600 rounded"
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
          <div className="bg-white w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 border border-primary/10 shadow-2xl">
            <h2 className="text-lg font-serif uppercase tracking-widest text-stone-800 mb-4">
              {editingCollection ? "Edit Collection" : "Add Collection"}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Collection Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20"
                  placeholder="E.G. SUMMER GLOSS EDIT"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 resize-none"
                  placeholder="Short line shown on the homepage card"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Homepage Position
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
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none"
                />
                <p className="text-[11px] text-stone-500">
                  Lower numbers appear first on the Collections tab.
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Cover Image
                </label>
                {displayPreview ? (
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary/20 border border-stone-200">
                    <Image
                      src={displayPreview}
                      alt="Cover preview"
                      fill
                      className="object-cover"
                      unoptimized={Boolean(imagePreview)}
                    />
                    <button
                      type="button"
                      onClick={clearSelectedImage}
                      className="absolute top-3 right-3 bg-white/95 p-2 text-red-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full aspect-[16/10] border border-dashed border-stone-200 bg-secondary/10 flex flex-col items-center justify-center gap-3"
                  >
                    <ImagePlus className="w-7 h-7 text-primary/50" />
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-stone-500">
                      Upload cover
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
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    Products ({selectedProductIds.length} selected)
                  </label>
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input
                      type="search"
                      placeholder="Search products..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-secondary/10 outline-none"
                    />
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto border border-stone-200 divide-y divide-stone-100">
                  {filteredProducts.length === 0 ? (
                    <p className="p-4 text-sm text-stone-500 text-center">
                      No products found
                    </p>
                  ) : (
                    filteredProducts.map((product) => {
                      const selected = selectedProductIds.includes(product._id);
                      const thumb = getProductDisplayImage(product.images);
                      return (
                        <button
                          key={product._id}
                          type="button"
                          onClick={() => toggleProduct(product._id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/40 transition-colors",
                            selected && "bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "w-5 h-5 shrink-0 border flex items-center justify-center",
                              selected
                                ? "bg-foreground border-foreground text-background"
                                : "border-stone-200",
                            )}
                          >
                            {selected ? <Check className="w-3 h-3" /> : null}
                          </span>
                          <div className="relative w-10 h-10 shrink-0 bg-secondary overflow-hidden">
                            {thumb ? (
                              <Image
                                src={thumb}
                                alt=""
                                fill
                                className="object-contain p-0.5"
                                sizes="40px"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {product.name}
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-stone-500">
                              {product.category} · £{product.price?.toFixed(2)}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
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
                  Show on homepage
                </span>
              </label>

              <div className="flex gap-4 pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 admin-btn-primary flex items-center justify-center gap-3"
                >
                  {isSubmitting && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                  {editingCollection ? "Update Collection" : "Create Collection"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-stone-200 text-[10px] uppercase tracking-[0.16em] font-bold"
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
