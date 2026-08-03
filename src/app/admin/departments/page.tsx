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
  Sprout,
} from "lucide-react";
import { toast } from "sonner";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  seedLinxDepartments,
  backfillProductDepartments,
} from "@/app/actions/departments";
import { notifyCatalogChange } from "@/lib/live-sync";

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    order: 0,
    isActive: true,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [existingImageUrl, setExistingImageUrl] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setIsLoading(true);
    const result = await getDepartments(true);
    if (result.success) setDepartments(result.departments);
    else toast.error("Failed to load departments");
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetImage = () => {
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl("");
    setRemoveImage(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openAdd = () => {
    setEditing(null);
    setFormData({ name: "", slug: "", description: "", order: 0, isActive: true });
    resetImage();
    setIsModalOpen(true);
  };

  const openEdit = (dept: any) => {
    setEditing(dept);
    setFormData({
      name: dept.name || "",
      slug: dept.slug || "",
      description: dept.description || "",
      order: dept.order ?? 0,
      isActive: dept.isActive !== false,
    });
    setImageFile(null);
    setImagePreview("");
    setExistingImageUrl(dept.image || "");
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
        formData.slug ||
          formData.name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
      );
      fd.append("description", formData.description);
      fd.append("order", String(formData.order));
      fd.append("isActive", formData.isActive ? "true" : "false");
      if (removeImage) {
        fd.append("imageUrl", "");
      } else {
        fd.append("imageUrl", uploadedImageUrl || "");
      }

      const result = editing
        ? await updateDepartment(editing._id, fd)
        : await createDepartment(fd);

      if (result.success) {
        toast.success(editing ? "Department updated" : "Department created");
        setIsModalOpen(false);
        load();
        notifyCatalogChange("departments");
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
    if (!confirm("Delete this department? Linked categories must be cleared first."))
      return;
    const result = await deleteDepartment(id);
    if (result.success) {
      toast.success("Department deleted");
      load();
      notifyCatalogChange("departments");
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const handleSeed = async () => {
    setIsSeeding(true);
    const result = await seedLinxDepartments();
    setIsSeeding(false);
    if (result.success) {
      toast.success(
        `Seeded ${result.total} departments (${result.created} new, ${result.updated} updated)`,
      );
      load();
      notifyCatalogChange("departments");
    } else {
      toast.error(result.error || "Seed failed");
    }
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    const result = await backfillProductDepartments(8000);
    setIsBackfilling(false);
    if (result.success) {
      toast.success(
        `Backfilled ${result.productsUpdated} products, linked ${result.menusLinked} menus`,
      );
      notifyCatalogChange("departments");
    } else {
      toast.error(result.error || "Backfill failed");
    }
  };

  const filtered = departments.filter((d) =>
    `${d.name} ${d.slug}`.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const displayPreview = imagePreview || (!removeImage ? existingImageUrl : "");

  return (
    <div className="max-w-7xl mx-auto admin-page pb-8 animate-in fade-in duration-300">
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary">Departments</span>
      </nav>

      <header className="admin-page-header">
        <div className="space-y-2 min-w-0">
          <h1 className="admin-page-title font-serif text-primary uppercase">
            Departments
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
            Top level of Department → Category → Subcategory → Products
          </p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleSeed}
            disabled={isSeeding}
            className="admin-btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            {isSeeding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sprout className="w-4 h-4" />
            )}
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              Seed LINX set
            </span>
          </button>
          <button
            type="button"
            onClick={handleBackfill}
            disabled={isBackfilling}
            className="admin-btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            {isBackfilling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              Backfill products
            </span>
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="admin-btn-primary inline-flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              Add Department
            </span>
          </button>
        </div>
      </header>

      <div className="admin-search flex items-center gap-3">
        <Search className="w-4 h-4 text-primary shrink-0" />
        <input
          type="search"
          placeholder="Search departments..."
          className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4 bg-white admin-panel-elevated">
          <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4 bg-white admin-panel-elevated px-4">
          <p className="text-stone-400 uppercase tracking-widest text-[11px] font-bold">
            No departments yet.
          </p>
          <button
            type="button"
            onClick={handleSeed}
            className="text-primary text-[10px] uppercase tracking-widest font-bold hover:underline"
          >
            Seed the LINX department set
          </button>
        </div>
      ) : (
        <>
          {/* Mobile / tablet cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
            {filtered.map((dept) => (
              <article
                key={dept._id}
                className="bg-white admin-panel-elevated overflow-hidden flex flex-col"
              >
                <div className="relative w-full aspect-[16/9] bg-stone-100 border-b border-stone-200/80">
                  {dept.image ? (
                    <Image
                      src={dept.image}
                      alt={dept.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, 50vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center border border-dashed border-stone-200 m-3 rounded-sm bg-secondary/30">
                      <span className="text-[9px] uppercase tracking-widest font-bold text-stone-400">
                        No cover
                      </span>
                    </div>
                  )}
                  <span
                    className={
                      dept.isActive !== false
                        ? "absolute top-2 right-2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-2.5 py-1 text-[9px] uppercase font-bold tracking-wider"
                        : "absolute top-2 right-2 rounded-full bg-stone-100 text-stone-500 border border-stone-200 px-2.5 py-1 text-[9px] uppercase font-bold tracking-wider"
                    }
                  >
                    {dept.isActive !== false ? "Active" : "Hidden"}
                  </span>
                </div>

                <div className="p-3.5 flex flex-col gap-3 flex-1">
                  <div className="min-w-0">
                    <h2 className="text-[12px] uppercase tracking-[0.12em] font-black text-stone-800 truncate">
                      {dept.name}
                    </h2>
                    <p className="text-[10px] text-stone-500 mt-1 break-all">
                      /{dept.slug}
                      <span className="text-stone-300 mx-1.5">·</span>
                      order {dept.order ?? 0}
                    </p>
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-1 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={() => openEdit(dept)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-stone-700 hover:bg-white hover:border-primary/30 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(dept._id)}
                      className="inline-flex items-center justify-center rounded-md border border-red-200/80 bg-red-50/50 px-3 py-2 text-red-600 hover:bg-red-50 transition-colors"
                      aria-label={`Delete ${dept.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Desktop table rows */}
          <div className="hidden lg:block bg-white admin-panel-elevated overflow-hidden">
            <div className="admin-list-head admin-table-head font-semibold tracking-[0.12em] py-2.5 px-4 grid grid-cols-[1fr_88px_80px_120px] gap-4 items-center">
              <span>Department</span>
              <span className="text-center">Cover</span>
              <span className="text-center">Status</span>
              <span className="text-right">Actions</span>
            </div>

            <div className="divide-y divide-primary/5">
              {filtered.map((dept) => (
                <div
                  key={dept._id}
                  className="admin-list-row grid grid-cols-[1fr_88px_80px_120px] gap-4 items-center py-4 px-4 hover:bg-secondary/50"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.12em] font-black text-stone-800">
                      {dept.name}
                    </p>
                    <p className="text-[10px] text-stone-500 mt-1 break-words">
                      /{dept.slug} · order {dept.order ?? 0}
                    </p>
                  </div>
                  <div className="flex justify-center">
                    {dept.image ? (
                      <div className="relative w-14 h-10 overflow-hidden bg-secondary border border-stone-200">
                        <Image
                          src={dept.image}
                          alt={dept.name}
                          fill
                          className="object-cover"
                          sizes="56px"
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-10 bg-secondary/40 border border-dashed border-stone-200" />
                    )}
                  </div>
                  <div className="text-center">
                    <span
                      className={
                        dept.isActive !== false
                          ? "text-[10px] uppercase font-bold text-emerald-700"
                          : "text-[10px] uppercase font-bold text-stone-400"
                      }
                    >
                      {dept.isActive !== false ? "Active" : "Hidden"}
                    </span>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(dept)}
                      className="p-2 hover:bg-secondary"
                      aria-label="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(dept._id)}
                      className="p-2 hover:bg-secondary text-red-600"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white w-full max-w-lg p-5 border border-primary/10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-serif uppercase tracking-widest mb-4">
              {editing ? "Edit Department" : "Add Department"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Name
                </label>
                <input
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none border-b"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Slug
                </label>
                <input
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData({ ...formData, slug: e.target.value })
                  }
                  placeholder="auto from name"
                  className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none border-b"
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
                  rows={3}
                  className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none border-b resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    Order
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
                    className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none border-b"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                    Status
                  </label>
                  <select
                    value={formData.isActive ? "true" : "false"}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        isActive: e.target.value === "true",
                      })
                    }
                    className="w-full bg-secondary/10 px-4 py-3 text-sm outline-none border-b"
                  >
                    <option value="true">Active</option>
                    <option value="false">Hidden</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Cover image
                </label>
                {displayPreview ? (
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary/20 border">
                    <Image
                      src={displayPreview}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="400px"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview("");
                        if (fileInputRef.current) fileInputRef.current.value = "";
                        if (existingImageUrl) setRemoveImage(true);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-white/90"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border border-dashed py-8 flex flex-col items-center gap-2 text-stone-500"
                  >
                    <ImagePlus className="w-5 h-5" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">
                      Upload image
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
                    if (!file.type.startsWith("image/")) {
                      toast.error("Please select an image file");
                      return;
                    }
                    setImageFile(file);
                    setRemoveImage(false);
                    setImagePreview(URL.createObjectURL(file));
                  }}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-[10px] uppercase tracking-widest font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="admin-btn-primary inline-flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  {editing ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
