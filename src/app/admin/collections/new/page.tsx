"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronRight, Upload, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

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

  const onSubmit = async (data: CollectionFormValues) => {
    setIsSaving(true);
    try {
      // Logic for saving collection to API
      console.log("Saving collection:", data);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success("Collection created successfully");
      router.push("/admin/collections");
    } catch {
      toast.error("Failed to create collection");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-700">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/40">
        <Link href="/admin" className="hover:text-[#333] transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-3 h-3" />
        <Link
          href="/admin/collections"
          className="hover:text-[#333] transition-colors"
        >
          Collections
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#333]">New Collection</span>
      </nav>

      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-5xl font-serif tracking-tight text-[#333] font-bold">
          New Collection
        </h1>
        <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-40">
          Create a new category for your products.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-12"
      >
        {/* Left Column: Collection Information */}
        <div className="lg:col-span-2 space-y-12">
          {/* General Information */}
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-10">
            <div className="space-y-1">
              <h2 className="text-xl font-serif text-[#333] font-bold">
                Collection Details
              </h2>
              <p className="text-[10px] uppercase tracking-widest opacity-40">
                Enter the basic information for this category.
              </p>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Name
                </label>
                <input
                  {...register("name")}
                  type="text"
                  placeholder="E.g. Luxury Tiles"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                />
                {errors.name && (
                  <p className="text-[10px] text-red-500 uppercase tracking-widest">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  URL Link
                </label>
                <div className="flex items-center gap-2 bg-secondary/10 px-4 py-4 border-b border-[#333]/10">
                  <span className="text-[10px] uppercase font-bold opacity-20 tracking-widest">
                    yourstore.com/collections/
                  </span>
                  <input
                    {...register("slug")}
                    type="text"
                    readOnly
                    className="bg-transparent text-sm font-bold tracking-widest text-[#333]/50 outline-none flex-1"
                  />
                </div>
                {errors.slug && (
                  <p className="text-[10px] text-red-500 uppercase tracking-widest">
                    {errors.slug.message}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Description
                </label>
                <textarea
                  {...register("description")}
                  placeholder="Describe your collection..."
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all min-h-[150px] resize-none"
                />
                {errors.description && (
                  <p className="text-[10px] text-red-500 uppercase tracking-widest">
                    {errors.description.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Media Section */}
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8">
            <h2 className="text-[11px] uppercase tracking-[0.5em] font-bold text-[#333] opacity-40 pb-6 border-b border-[#333]/5">
              Collection Images
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                type="button"
                className="aspect-square bg-secondary/10 border border-dashed border-[#333]/10 flex flex-col items-center justify-center gap-4 hover:bg-secondary/20 transition-all group"
              >
                <Upload className="w-5 h-5 opacity-20 group-hover:opacity-40 transition-opacity" />
                <span className="text-[8px] uppercase tracking-widest font-bold opacity-40">
                  Upload
                </span>
              </button>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8">
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 text-[#333]">
            <h2 className="text-xl font-serif font-bold">Settings</h2>

            <div className="space-y-6">
              <div className="space-y-3 relative group">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-60">
                  Status
                </label>
                <div className="relative">
                  <select
                    {...register("status")}
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-[12px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Draft">Draft</option>
                    <option value="Archived">Archived</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-60">
                  Who can see this?
                </label>
                <div className="relative group">
                  <select
                    {...register("visibility")}
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-[12px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Public">Everyone</option>
                    <option value="Private">Only Admins</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-[#333] text-white py-5 text-[11px] uppercase tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-50"
            >
              {isSaving ? "Creating..." : "Create Collection"}
            </button>
            <Link
              href="/admin/collections"
              className="block w-full text-center border border-[#333]/10 py-5 text-[11px] uppercase tracking-[0.4em] font-bold hover:bg-secondary/30 transition-all text-[#333]"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
