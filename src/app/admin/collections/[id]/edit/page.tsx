"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Upload,
  ChevronDown,
  Trash2,
  AlertCircle,
} from "lucide-react";
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

export default function EditCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const collectionId = unwrappedParams.id;
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Mocking pre-population:
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionSchema),
    defaultValues: {
      name: "Luxury Tiles",
      description:
        "Our curated selection of al tiles, excavated from private quarries and refined using proprietary harmonic techniques.",
      slug: "tiles",
      status: "Active",
      visibility: "Public",
    },
  });

  const name = watch("name");

  // Auto-generate URL link from name (only if it changes from initial)
  React.useEffect(() => {
    // In a real edit page, we might not want to auto-change the slug every time
    // but for this redesign we'll follow the same logic as Add page
  }, [name, setValue]);

  const onSubmit = async (data: CollectionFormValues) => {
    setIsSaving(true);
    try {
      // Logic for saving collection to API
      console.log("Saving revisions:", data);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success("Collection updated successfully");
      router.push("/admin/collections");
    } catch {
      toast.error("Failed to update collection");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    toast.success("Collection removed successfully");
    router.push("/admin/collections");
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
        <span className="text-[#333]">Edit Collection</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif tracking-tight text-[#333] font-bold">
            Edit Collection
          </h1>
          <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-40">
            REF: {collectionId} • Updating category details.
          </p>
        </div>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] font-bold text-red-600/50 hover:text-red-600 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete Collection
        </button>
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
                Update the information for this category.
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
                  placeholder="Collection name"
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
                  Replace
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
              {isSaving ? "Updating..." : "Save Changes"}
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

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 animate-in fade-in duration-700">
          <div className="bg-white w-full max-w-2xl p-20 shadow-2xl border border-[#333]/5 relative overflow-hidden text-center">
            <div className="relative z-10 flex flex-col items-center space-y-12">
              <div className="w-32 h-px bg-red-600/20" />
              <div className="space-y-6">
                <h2 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
                  Delete Collection
                </h2>
                <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-40 leading-loose max-w-sm mx-auto">
                  Are you sure you want to permanently delete <br />
                  <span className="text-red-600 font-serif normal-case italic text-2xl tracking-normal">
                    Luxury Tiles
                  </span>
                </p>
              </div>
              <div className="flex flex-col w-full gap-5">
                <button
                  onClick={handleDelete}
                  className="w-full bg-red-600 text-white py-8 text-[11px] uppercase tracking-[0.5em] font-bold hover:bg-black transition-all duration-700 shadow-xl"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="w-full text-[#333] py-8 text-[11px] uppercase tracking-[0.5em] font-bold border border-[#333]/5 hover:bg-secondary transition-colors"
                >
                  Keep Collection
                </button>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
              <AlertCircle className="w-64 h-64 text-red-600" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
