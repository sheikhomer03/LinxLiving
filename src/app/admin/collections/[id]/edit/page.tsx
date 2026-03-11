"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Upload,
  ChevronDown,
  Trash2,
  AlertCircle,
  X,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Image from "next/image";
import { updateCollection, getCollection } from "@/app/actions/admin";

const collectionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  slug: z.string().min(1, "URL Link is required"),
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [collection, setCollection] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionSchema),
    defaultValues: {
      name: "",
      description: "",
      slug: "",
    },
  });

  const name = watch("name");

  // Auto-generate URL link from name when edited
  React.useEffect(() => {
    if (name) {
      const generatedSlug = name
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/[^\w-]+/g, "");
      setValue("slug", generatedSlug);
    }
  }, [name, setValue]);

  React.useEffect(() => {
    async function loadCollection() {
      try {
        const data = await getCollection(collectionId);
        if (data) {
          setCollection(data);
          reset({
            name: data.name,
            description: data.description,
            slug: data.slug,
          });
          if (data.image) {
            setImagePreview(data.image);
          }
        } else {
          toast.error("Collection not found");
          router.push("/admin/collections");
        }
      } catch (error) {
        toast.error("Failed to load collection");
      } finally {
        setIsLoading(false);
      }
    }
    loadCollection();
  }, [collectionId, reset, router]);

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

      // Keep original image string if we haven't selected a new file but we have a preview
      if (!imageFile && imagePreview && collection?.image === imagePreview) {
        formData.append("image", imagePreview);
      }

      if (imageFile) {
        formData.append("imageFile", imageFile);
      }

      const result = await updateCollection(collectionId, formData);

      if (result.success) {
        toast.success("Collection updated successfully");
        router.push("/admin/collections");
      } else {
        toast.error(result.error || "Failed to update collection");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    // Relying on the list page or a specific action. For simplicity, we just trigger it and route.
    // We already have showDeleteModal
  };

  if (isLoading || !collection) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700 px-4 sm:px-0">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <Link
          href="/admin/collections"
          className="hover:text-primary transition-colors"
        >
          Collections
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary truncate">Edit Collection</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-8">
        <div className="space-y-2 lg:space-y-3">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
            Edit Collection
          </h1>
          <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-80">
            REF: {collectionId} • Updating category details.
          </p>
        </div>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-2.5 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-red-600/60 hover:text-red-600 transition-colors w-fit"
        >
          <Trash2 className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
          Delete Collection
        </button>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12"
      >
        {/* Left Column: Collection Information */}
        <div className="lg:col-span-2 space-y-8 lg:space-y-12">
          {/* General Information */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-primary font-bold">
                Collection Details
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-80">
                Update the information for this category.
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
                    placeholder="Collection name"
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
                {errors.name && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="hidden">
                <input {...register("slug")} type="hidden" />
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
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
              Collection Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
              <label className="aspect-square bg-primary/5 border border-dashed border-primary/30 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-primary/10 transition-all group relative overflow-hidden cursor-pointer">
                {imagePreview ? (
                  <Image
                    src={imagePreview}
                    alt="Preview"
                    fill
                    className="object-cover"
                  />
                ) : (
                  <>
                    <Upload className="w-4 h-4 lg:w-5 lg:h-5 text-primary opacity-90 group-hover:opacity-100 transition-opacity" />
                    <span className="text-[7.5px] lg:text-[8px] uppercase tracking-widest font-bold text-primary opacity-80">
                      Replace
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
          {/* Actions */}
          <div className="flex flex-col gap-3 lg:gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-[#1a1a1a] text-primary py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-80 border border-primary/20"
            >
              {isSaving ? "Updating..." : "Save Changes"}
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

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />

          {/* Modal Content */}
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => !isDeleting && setShowDeleteModal(false)}
              disabled={isDeleting}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10 disabled:opacity-80"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-90" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-[#333]">
                  Delete Collection
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Are you sure you want to permanently delete{" "}
                  <span className="font-bold text-[#333]">
                    {collection?.name || "this collection"}
                  </span>
                  ?
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  type="button"
                  onClick={async () => {
                    const { deleteCollection } =
                      await import("@/app/actions/admin");
                    const res = await deleteCollection(collectionId);
                    if (res.success) {
                      toast.success("Collection removed successfully");
                      router.push("/admin/collections");
                    } else {
                      toast.error(res.error || "Failed to delete collection");
                      setShowDeleteModal(false);
                    }
                  }}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-3"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
                >
                  Keep Collection
                </button>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="h-1.5 w-full bg-linear-to-r from-red-600/20 via-red-600/10 to-transparent" />
          </div>
        </div>
      )}
    </div>
  );
}
