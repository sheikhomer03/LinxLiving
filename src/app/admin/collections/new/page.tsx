"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronRight, Upload, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { createCollection } from "@/app/actions/admin";
import Image from "next/image";

const collectionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  slug: z.string().min(1, "URL Link is required"),
  status: z.string(),
  visibility: z.string(),
});

type CollectionFormValues = z.infer<typeof collectionSchema>;

export default function AddCollectionPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionSchema),
    defaultValues: {
      status: "Active",
      visibility: "Public",
      name: "",
      description: "",
      slug: "",
    },
  });

  const name = watch("name");

  // Auto-generate URL link from name
  React.useEffect(() => {
    if (name) {
      const generatedSlug = name
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/[^\w-]+/g, "");
      setValue("slug", generatedSlug);
    }
  }, [name, setValue]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const onSubmit = async (data: CollectionFormValues) => {
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("description", data.description);
      formData.append("slug", data.slug);
      formData.append("status", data.status);
      formData.append("visibility", data.visibility);

      if (imageFile) {
        formData.append("imageFile", imageFile);
      }

      const result = await createCollection(formData);

      if (result.success) {
        toast.success("Collection created successfully");
        router.push("/admin/collections");
      } else {
        toast.error(result.error || "Failed to create collection");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700 px-4 sm:px-0">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/40">
        <Link href="/admin" className="hover:text-[#333] transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <Link
          href="/admin/collections"
          className="hover:text-[#333] transition-colors"
        >
          Collections
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-[#333] truncate">New Collection</span>
      </nav>

      {/* Header */}
      <header className="space-y-2 lg:space-y-3">
        <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
          New Collection
        </h1>
        <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-40">
          Create a new category for your products.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12"
      >
        {/* Left Column: Collection Information */}
        <div className="lg:col-span-2 space-y-8 lg:space-y-12">
          {/* General Information */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-[#333] font-bold">
                Collection Details
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-40">
                Enter the basic information for this category.
              </p>
            </div>

            <div className="space-y-6 lg:space-y-8">
              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Name
                </label>
                <div className="input-standard">
                  <input
                    {...register("name")}
                    type="text"
                    placeholder="E.g. Luxury Tiles"
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
                {errors.name && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  URL Link
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-secondary/5 px-4 py-3.5 lg:py-4 input-standard border border-[#333]/5">
                  <span className="text-[8px] lg:text-[10px] uppercase font-bold opacity-20 tracking-widest truncate">
                    yourstore.com/collections/
                  </span>
                  <input
                    {...register("slug")}
                    type="text"
                    readOnly
                    className="bg-transparent text-sm font-bold tracking-widest text-[#333]/50 outline-none flex-1 min-w-0"
                  />
                </div>
                {errors.slug && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.slug.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Description
                </label>
                <div className="input-standard">
                  <textarea
                    {...register("description")}
                    placeholder="Describe your collection..."
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all min-h-[120px] lg:min-h-[150px] resize-none focus:bg-white"
                  />
                </div>
                {errors.description && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.description.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Media Section */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-[#333] opacity-40 pb-4 lg:pb-6 border-b border-[#333]/5">
              Collection Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
              <label className="aspect-square bg-secondary/10 border border-dashed border-[#333]/10 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-secondary/20 transition-all group cursor-pointer relative overflow-hidden">
                {imagePreview ? (
                  <Image
                    src={imagePreview}
                    alt="Preview"
                    fill
                    className="object-cover"
                  />
                ) : (
                  <>
                    <Upload className="w-4 h-4 lg:w-5 lg:h-5 opacity-20 group-hover:opacity-40 transition-opacity" />
                    <span className="text-[7.5px] lg:text-[8px] uppercase tracking-widest font-bold opacity-40">
                      Upload
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleImageChange}
                />
              </label>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8">
          {/* Settings */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-6 lg:space-y-8 text-[#333]">
            <h2 className="text-lg lg:text-xl font-serif font-bold">
              Settings
            </h2>

            <div className="space-y-5 lg:space-y-6">
              <div className="space-y-2 lg:space-y-3 relative group">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-60">
                  Status
                </label>
                <div className="relative">
                  <select
                    {...register("status")}
                    className="w-full bg-secondary/10 border-b border-[#333]/10 px-4 py-3.5 lg:py-4 text-[11px] lg:text-[12px] uppercase tracking-[0.1em] lg:tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Draft">Draft</option>
                    <option value="Archived">Archived</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>

              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-60">
                  Who can see this?
                </label>
                <div className="relative group">
                  <select
                    {...register("visibility")}
                    className="w-full bg-secondary/10 border-b border-[#333]/10 px-4 py-3.5 lg:py-4 text-[11px] lg:text-[12px] uppercase tracking-[0.1em] lg:tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Public">Everyone</option>
                    <option value="Private">Only Admins</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-3 lg:gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-[#333] text-white py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-50"
            >
              {isSaving ? "Creating..." : "Create Collection"}
            </button>
            <Link
              href="/admin/collections"
              className="block w-full text-center border border-[#333]/10 py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-secondary/30 transition-all text-[#333]"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
