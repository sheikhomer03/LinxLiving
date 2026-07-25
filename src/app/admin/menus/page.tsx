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
  GripVertical,
  Search,
  ImagePlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getMenuTree,
  createMenu,
  updateMenu,
  deleteMenu,
  getBrands,
} from "@/app/actions/admin";
import { cn } from "@/lib/utils";
import { notifyCatalogChange } from "@/lib/live-sync";
import { useShopifyAutoSyncListener } from "@/components/admin/ShopifyAdminAutoSync";

export default function MenusPage() {
  const [menuTree, setMenuTree] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingMenu, setEditingMenu] = useState<any>(null);
  const [parentMenu, setParentMenu] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    order: 0,
    brand: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [existingImageUrl, setExistingImageUrl] = useState<string>("");
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadMenus = async () => {
    setIsLoading(true);
    const [menuResult, brandResult] = await Promise.all([
      getMenuTree(),
      getBrands(),
    ]);
    if (menuResult.success) {
      setMenuTree(menuResult.tree);
    } else {
      toast.error("Failed to load menus");
    }
    if (brandResult.success) {
      setBrands(brandResult.brands);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadMenus();
  }, []);

  useShopifyAutoSyncListener(() => {
    getMenuTree().then((result) => {
      if (result.success) setMenuTree(result.tree);
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

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let uploadedImageUrl = existingImageUrl;

      // Upload to Cloudinary first (same pattern as products)
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
      const generatedSlug = formData.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      fd.append("slug", generatedSlug);
      fd.append("order", formData.order.toString());
      if (parentMenu) {
        fd.append("parent", parentMenu._id);
      } else if (editingMenu?.parent) {
        fd.append("parent", editingMenu.parent);
      } else if (formData.brand) {
        fd.append("brand", formData.brand);
      }

      if (removeImage) {
        fd.append("removeImage", "true");
        fd.append("imageUrl", "");
      } else {
        fd.append("imageUrl", uploadedImageUrl || "");
      }

      let result;
      if (editingMenu) {
        result = await updateMenu(editingMenu._id, fd);
      } else {
        result = await createMenu(fd);
      }

      if (result.success) {
        toast.success(
          `Menu ${editingMenu ? "updated" : "created"} successfully`,
        );
        setIsModalOpen(false);
        setEditingMenu(null);
        setParentMenu(null);
        setFormData({ name: "", slug: "", order: 0, brand: "" });
        resetImageState();
        loadMenus();
        notifyCatalogChange("menus");
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
    if (!confirm("Are you sure? Items in this category might become unlinked."))
      return;

    const result = await deleteMenu(id);
    if (result.success) {
      toast.success("Menu deleted successfully");
      loadMenus();
      notifyCatalogChange("menus");
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const openAddModal = (parent: any = null) => {
    setParentMenu(parent);
    setEditingMenu(null);
    setFormData({
      name: "",
      slug: "",
      order: 0,
      brand: parent?.brand || brands[0]?._id || "",
    });
    resetImageState();
    setIsModalOpen(true);
  };

  const openEditModal = (menu: any) => {
    setEditingMenu(menu);
    setParentMenu(null);
    setFormData({
      name: menu.name,
      slug: menu.slug,
      order: menu.order,
      brand: menu.brand || "",
    });
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl(menu.image || "");
    setRemoveImage(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsModalOpen(true);
  };

  const displayPreview = imagePreview || (!removeImage ? existingImageUrl : "");
  const isTopLevelMenu = !parentMenu && !editingMenu?.parent;
  const brandNameById = Object.fromEntries(
    brands.map((brand) => [brand._id, brand.name]),
  );

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Menus & Categories</span>
      </nav>

      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Menus
          </h1>
        </div>
        <button
          onClick={() => openAddModal()}
          className="w-full sm:w-auto admin-btn-primary inline-flex items-center justify-center gap-2 group"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              Add Menu
            </span>
          </div>

        </button>
      </header>

      <div className="admin-search flex items-center gap-3">
        <div className="shrink-0">
          <Search className="w-4 h-4 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search menus by name..."
            className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white admin-panel-elevated overflow-hidden font-sans">
        <div className="admin-table-head font-semibold tracking-[0.12em] py-2.5 px-4 grid grid-cols-[1fr_120px_88px_120px] lg:grid-cols-[1fr_140px_120px_140px] gap-4 items-center">
          <span>Menu Item</span>
          <span>Brand</span>
          <span className="text-center">Image</span>
          <span className="text-right">Actions</span>
        </div>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">
              Loading Structure...
            </p>
          </div>
        ) : menuTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <p className="text-stone-400 uppercase tracking-widest text-[11px] font-bold font-sans">
              No menus created yet.
            </p>
            <button
              onClick={() => openAddModal()}
              className="text-primary text-[10px] uppercase tracking-widest font-bold hover:underline font-sans"
            >
              Initialize your first category
            </button>
          </div>
        ) : (
          <div className="divide-y divide-primary/5">
            {menuTree
              .filter((item) => {
                if (!searchTerm) return true;
                const matchesSearch = (menu: any): boolean => {
                  if (
                    menu.name.toLowerCase().includes(searchTerm.toLowerCase())
                  )
                    return true;
                  if (menu.children && menu.children.length > 0) {
                    return menu.children.some((child: any) =>
                      matchesSearch(child),
                    );
                  }
                  return false;
                };
                return matchesSearch(item);
              })
              .map((item) => (
                <MenuRow
                  key={item._id}
                  item={item}
                  searchTerm={searchTerm}
                  brandNameById={brandNameById}
                  onAddSub={openAddModal}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                />
              ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center admin-modal-overlay p-4">
          <div className="bg-white w-full max-w-lg p-4 sm:p-5 border border-primary/10 shadow-2xl animate-in fade-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-serif uppercase tracking-widest text-stone-800 mb-4">
              {editingMenu
                ? "Edit Menu"
                : parentMenu
                  ? `Add Sub-category to ${parentMenu.name}`
                  : "Add Main Menu"}
            </h2>

            <form onSubmit={handleCreateOrUpdate} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 transition-all font-medium"
                  placeholder="E.G. STONE BATHS"
                />
              </div>

              {isTopLevelMenu && (
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    Brand
                  </label>
                  <select
                    required
                    value={formData.brand}
                    onChange={(e) =>
                      setFormData({ ...formData, brand: e.target.value })
                    }
                    className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 transition-all font-medium"
                  >
                    <option value="">Select brand</option>
                    {brands.map((brand) => (
                      <option key={brand._id} value={brand._id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Display Order
                </label>
                <input
                  type="number"
                  value={formData.order}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      order: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-secondary/10 px-5 py-4 text-sm outline-none focus:bg-white border border-transparent focus:border-primary/20 transition-all"
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Category Image
                </label>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Used on the homepage and category displays. Uploaded to
                  Cloudinary.
                </p>

                {displayPreview ? (
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary/20 border border-stone-200">
                    <Image
                      src={displayPreview}
                      alt="Category preview"
                      fill
                      className="object-contain bg-secondary/20"
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
                      Upload image
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

              <div className="flex gap-4 pt-6">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 admin-btn-primary rounded-lg py-2.5 text-[10px] uppercase tracking-[0.16em] font-bold hover:opacity-90 transition-all shadow-sm flex items-center justify-center gap-3"
                >
                  {isSubmitting && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                  {editingMenu ? "Update Menu" : "Create Menu"}
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

function MenuRow({
  item,
  onAddSub,
  onEdit,
  onDelete,
  level = 0,
  searchTerm = "",
  brandNameById = {},
}: any) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;

  useEffect(() => {
    if (searchTerm && hasChildren) {
      const someChildMatches = item.children.some(
        (child: any) =>
          child.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (child.children &&
            child.children.some((gc: any) =>
              gc.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )),
      );
      if (someChildMatches) setIsExpanded(true);
    }
  }, [searchTerm, hasChildren, item.children]);

  const filteredChildren = searchTerm
    ? item.children.filter((child: any) => {
        const matches = (menu: any): boolean => {
          if (menu.name.toLowerCase().includes(searchTerm.toLowerCase()))
            return true;
          if (menu.children && menu.children.length > 0) {
            return menu.children.some((gc: any) => matches(gc));
          }
          return false;
        };
        return matches(child);
      })
    : item.children;

  return (
    <div className="w-full">
      <div
        className={cn(
          "group grid grid-cols-[1fr_120px_88px_120px] lg:grid-cols-[1fr_140px_120px_140px] gap-4 items-center py-4 px-4 hover:bg-secondary/50 transition-colors border-l-4 border-transparent",
          level > 0 && "bg-secondary/5 border-primary/10",
          searchTerm &&
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
            "bg-primary/5 border-l-primary",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div style={{ width: `${level * 24}px` }} className="shrink-0" />
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "p-1 hover:bg-primary/5 rounded transition-transform text-primary/90 group-hover:text-primary shrink-0",
              !hasChildren && "opacity-0 cursor-default",
              isExpanded && "rotate-90",
            )}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <GripVertical className="w-3 h-3 text-primary/10 shrink-0" />
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex flex-col text-left hover:opacity-80 transition-opacity font-sans min-w-0"
          >
            <span
              className={cn(
                "text-[10px] lg:text-[11px] uppercase tracking-[0.12em] font-black text-stone-800 truncate",
                level === 0 ? "font-bold" : "font-medium",
              )}
            >
              {item.name}
            </span>
          </button>
        </div>

        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-stone-500">
          {item.brand ? brandNameById[item.brand] || "—" : level > 0 ? "Inherited" : "—"}
        </div>

        <div className="flex justify-center">
          {item.image ? (
            <div className="relative w-12 h-12 lg:w-14 lg:h-14 overflow-hidden bg-secondary border border-stone-200">
              <Image
                src={item.image}
                alt={item.name}
                fill
                className="object-contain p-0.5"
                sizes="56px"
              />
            </div>
          ) : (
            <div className="w-12 h-12 lg:w-14 lg:h-14 bg-secondary/40 border border-dashed border-stone-200 flex items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-stone-400 font-bold">
                None
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-1 lg:gap-2 shrink-0">
          {level === 0 && (
            <button
              type="button"
              onClick={() => onAddSub(item)}
              className="p-2 hover:bg-primary text-primary hover:text-white rounded transition-colors"
              title="Add Sub-category"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="p-2 hover:bg-blue-50 text-blue-600 rounded transition-colors"
            title="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item._id)}
            className="p-2 hover:bg-red-50 text-red-600 rounded transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="border-t border-primary/5">
          {filteredChildren.map((child: any) => (
            <MenuRow
              key={child._id}
              item={child}
              searchTerm={searchTerm}
              brandNameById={brandNameById}
              onAddSub={onAddSub}
              onEdit={onEdit}
              onDelete={onDelete}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
