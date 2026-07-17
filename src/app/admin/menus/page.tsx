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
} from "@/app/actions/admin";
import { cn } from "@/lib/utils";

export default function MenusPage() {
  const [menuTree, setMenuTree] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingMenu, setEditingMenu] = useState<any>(null);
  const [parentMenu, setParentMenu] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    order: 0,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [existingImageUrl, setExistingImageUrl] = useState<string>("");
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadMenus = async () => {
    setIsLoading(true);
    const result = await getMenuTree();
    if (result.success) {
      setMenuTree(result.tree);
    } else {
      toast.error("Failed to load menus");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadMenus();
  }, []);

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
        setFormData({ name: "", slug: "", order: 0 });
        resetImageState();
        loadMenus();
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
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const openAddModal = (parent = null) => {
    setParentMenu(parent);
    setEditingMenu(null);
    setFormData({ name: "", slug: "", order: 0 });
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
    });
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl(menu.image || "");
    setRemoveImage(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsModalOpen(true);
  };

  const displayPreview = imagePreview || (!removeImage ? existingImageUrl : "");

  return (
    <div className="max-w-7xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Menus & Categories</span>
      </nav>

      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold uppercase">
            Menus
          </h1>
        </div>
        <button
          onClick={() => openAddModal()}
          className="w-full sm:w-auto bg-[#1a1a1a] hover:bg-black text-primary px-8 lg:px-10 py-3.5 lg:py-4 transition-all shadow-xl flex items-center justify-center gap-4 group overflow-hidden relative border border-primary/20"
        >
          <div className="relative z-10 flex items-center gap-4">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] lg:text-[11px] uppercase tracking-[0.4em] font-black">
              Add Menu
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/20" />
        </button>
      </header>

      <div className="bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-[#333]/5 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12">
        <div className="shrink-0">
          <Search className="w-5 h-5 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search menus by name..."
            className="w-full bg-transparent placeholder:text-[#333]/60 text-base lg:text-lg font-serif tracking-wide text-[#333] outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden font-sans">
        <div className="bg-[#1a1a1a] text-primary font-black text-[11px] lg:text-[12px] uppercase tracking-[0.2em] py-5 px-6 lg:px-10 grid grid-cols-[1fr_88px_120px] lg:grid-cols-[1fr_120px_140px] gap-4 items-center">
          <span>Menu Item</span>
          <span className="text-center">Image</span>
          <span className="text-right">Actions</span>
        </div>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">
              Loading Structure...
            </p>
          </div>
        ) : menuTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <p className="text-[#333]/40 uppercase tracking-widest text-[11px] font-bold font-sans">
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
                  onAddSub={openAddModal}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                />
              ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg p-8 lg:p-12 border border-primary/10 shadow-2xl animate-in fade-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-serif uppercase tracking-widest text-[#333] mb-8">
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
                <p className="text-[11px] text-[#333]/50 leading-relaxed">
                  Used on the homepage and category displays. Uploaded to
                  Cloudinary.
                </p>

                {displayPreview ? (
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary/20 border border-[#333]/10">
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
                    className="w-full aspect-[16/10] border border-dashed border-[#333]/20 hover:border-primary/40 bg-secondary/10 flex flex-col items-center justify-center gap-3 transition-colors"
                  >
                    <ImagePlus className="w-7 h-7 text-primary/50" />
                    <span className="text-[10px] uppercase tracking-[0.25em] font-bold text-[#333]/50">
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
                  className="flex-1 bg-[#333] text-white py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-black transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  {isSubmitting && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                  {editingMenu ? "Update Menu" : "Create Menu"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-8 bg-white text-[#333] py-5 text-[10px] uppercase tracking-[0.3em] font-bold border border-[#333]/10 hover:bg-secondary/30 transition-all"
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
          "group grid grid-cols-[1fr_88px_120px] lg:grid-cols-[1fr_120px_140px] gap-4 items-center py-4 px-6 lg:px-10 hover:bg-secondary/50 transition-colors border-l-4 border-transparent",
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
                "text-[10px] lg:text-[11px] uppercase tracking-[0.2em] font-black text-[#333] truncate",
                level === 0 ? "font-bold" : "font-medium",
              )}
            >
              {item.name}
            </span>
          </button>
        </div>

        <div className="flex justify-center">
          {item.image ? (
            <div className="relative w-12 h-12 lg:w-14 lg:h-14 overflow-hidden bg-secondary border border-[#333]/10">
              <Image
                src={item.image}
                alt={item.name}
                fill
                className="object-contain p-0.5"
                sizes="56px"
              />
            </div>
          ) : (
            <div className="w-12 h-12 lg:w-14 lg:h-14 bg-secondary/40 border border-dashed border-[#333]/15 flex items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-[#333]/35 font-bold">
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
