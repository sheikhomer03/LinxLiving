"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronRight, Upload, ChevronDown, X, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { createProduct, getCollections } from "@/app/actions/admin";
import { cn } from "@/lib/utils";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  price: z.number().min(0, "Price must be positive"),
  stock: z.number().min(0, "Stock must be positive"),
  category: z.string().min(1, "Category is required"),
  status: z.string(),
  images: z.array(z.string()).min(1, "At least one image is required"),
  specs: z
    .object({
      material: z.string().optional(),
      finish: z.string().optional(),
      size: z.string().optional(),
      slipRating: z.string().optional(),
      variation: z.string().optional(),
      suitability: z.string().optional(),
      rectifiedEdge: z.string().optional(),
      thickness: z.string().optional(),
    })
    .optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function AddProductPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [collections, setCollections] = useState<any[]>([]);

  React.useEffect(() => {
    async function loadCollections() {
      try {
        const data = await getCollections();
        setCollections(data);
      } catch (error) {
        toast.error("Failed to load collections");
      }
    }
    loadCollections();
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      status: "Draft",
      name: "",
      description: "",
      price: 0,
      stock: 0,
      category: "",
      images: [],
      specs: {
        material: "",
        finish: "",
        size: "",
        slipRating: "",
        variation: "",
        suitability: "",
        rectifiedEdge: "",
        thickness: "",
      },
    },
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...newFiles]);

    const newPreviews = newFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls((prev) => [...prev, ...newPreviews]);

    // Update the 'images' field so validation passes (we'll send the actual files later)
    const currentImages = watch("images") || [];
    setValue("images", [...currentImages, ...newPreviews], {
      shouldValidate: true,
    });
  };

  const removeImage = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    const newPreviews = previewUrls.filter((_, i) => i !== index);

    // Revoke the URL for the removed preview to avoid memory leaks
    URL.revokeObjectURL(previewUrls[index]);

    setSelectedFiles(newFiles);
    setPreviewUrls(newPreviews);
    setValue("images", newPreviews, { shouldValidate: true });
  };

  const onSubmit = async (data: ProductFormValues) => {
    setIsSaving(true);
    try {
      // Step 1: Upload all selected images to B2 via the API route
      const uploadedUrls: string[] = [];
      for (const file of selectedFiles) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/admin/upload", {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || !json.url) {
          throw new Error(json.error || "Image upload failed");
        }
        uploadedUrls.push(json.url);
      }

      // Step 2: Create the product with the cloud image URLs
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("description", data.description);
      formData.append("price", data.price.toString());
      formData.append("stock", data.stock.toString());
      formData.append("category", data.category);
      formData.append("status", data.status);
      formData.append("specs", JSON.stringify(data.specs));
      formData.append("images", JSON.stringify(uploadedUrls));

      const result = await createProduct(formData);
      if (result.success) {
        toast.success("Product created successfully");
        router.push("/admin/products");
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create product");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700 px-4 sm:px-0">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/40">
        <Link
          href="/admin"
          className="hover:text-[#333] transition-colors"
          tabIndex={-1}
        >
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <Link
          href="/admin/products"
          className="hover:text-[#333] transition-colors"
          tabIndex={-1}
        >
          Products
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-[#333] truncate">New Product</span>
      </nav>

      {/* Header */}
      <header className="space-y-2 lg:space-y-3">
        <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
          New Product
        </h1>
        <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-40">
          Add a new product to the catalog.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12"
      >
        {/* Left Column: Product Information & Specs */}
        <div className="lg:col-span-2 space-y-8 lg:space-y-12">
          {/* General Information */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-[#333] font-bold">
                Product Information
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-40">
                Enter the basic details for the new product.
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
                    placeholder="Product name"
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
                  Description
                </label>
                <div className="input-standard">
                  <textarea
                    {...register("description")}
                    placeholder="Product description"
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all min-h-[120px] lg:min-h-[150px] resize-none focus:bg-white"
                  />
                </div>
                {errors.description && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
                <div className="space-y-2 lg:space-y-3">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                    Price (£)
                  </label>
                  <div className="input-standard">
                    <input
                      {...register("price", { valueAsNumber: true })}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white"
                    />
                  </div>
                  {errors.price && (
                    <p className="text-[9px] text-red-500 uppercase tracking-widest">
                      {errors.price.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2 lg:space-y-3">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                    Stock
                  </label>
                  <div className="input-standard">
                    <input
                      {...register("stock", { valueAsNumber: true })}
                      type="number"
                      placeholder="0"
                      className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white"
                    />
                  </div>
                  {errors.stock && (
                    <p className="text-[9px] text-red-500 uppercase tracking-widest">
                      {errors.stock.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Technical Specifications */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-xl font-serif text-[#333] font-bold lowercase">
                TECHNICAL <span className="uppercase">SPECIFICATIONS</span>
              </h2>
              <p className="text-[10px] uppercase tracking-widest opacity-40">
                Define the characteristics of this piece.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12 gap-y-6 lg:gap-y-8">
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Material
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.material")}
                    placeholder="E.G. POLISHED PORCELAIN"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Finish
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.finish")}
                    placeholder="E.G. HIGH GLOSS"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Size
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.size")}
                    placeholder="E.G. 600 X 1200 MM"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Slip Rating
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.slipRating")}
                    placeholder="E.G. R9"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Variation
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.variation")}
                    placeholder="E.G. V2 - SLIGHT VARIATION"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Suitability
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.suitability")}
                    placeholder="E.G. INTERNAL FLOOR & WALL"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Rectified Edge
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.rectifiedEdge")}
                    placeholder="E.G. YES"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                  Thickness
                </label>
                <div className="input-standard">
                  <input
                    {...register("specs.thickness")}
                    placeholder="E.G. 9.5 MM"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Media Section */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-[#333] opacity-40 pb-4 lg:pb-6 border-b border-[#333]/5">
              Product Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
              {previewUrls.map((url: string, index: number) => (
                <div
                  key={index}
                  className="relative aspect-square border border-[#333]/5 group"
                >
                  <img
                    src={url}
                    alt={`Product image ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-[#333]/10 rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <label
                className={cn(
                  "aspect-square bg-secondary/10 border border-dashed border-[#333]/10 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-secondary/20 transition-all group cursor-pointer",
                )}
              >
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Upload className="w-5 h-5 opacity-20 group-hover:opacity-40 transition-opacity" />
                <span className="text-[8px] uppercase tracking-widest font-bold opacity-40">
                  Upload
                </span>
              </label>
            </div>
            {errors.images && (
              <p className="text-[9px] text-red-500 uppercase tracking-widest">
                {errors.images.message}
              </p>
            )}
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8">
          {/* Organization & Status */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-6 lg:space-y-8 text-[#333]">
            <h2 className="text-lg lg:text-xl font-serif font-bold">
              Organization
            </h2>

            <div className="space-y-5 lg:space-y-6">
              <div className="space-y-2 lg:space-y-3 relative group">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-60">
                  Category
                </label>
                <div className="relative">
                  <select
                    {...register("category")}
                    className="w-full bg-secondary/10 border-b border-[#333]/10 px-4 py-3.5 lg:py-4 text-[11px] lg:text-[12px] uppercase tracking-[0.1em] lg:tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="">Select a Collection</option>
                    {collections.map((c) => (
                      <option key={c._id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
                {errors.category && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.category.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-60">
                  Status
                </label>
                <div className="relative group">
                  <select
                    {...register("status")}
                    className="w-full bg-secondary/10 border-b border-[#333]/10 px-4 py-3.5 lg:py-4 text-[11px] lg:text-[12px] uppercase tracking-[0.1em] lg:tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Active">Active</option>
                    <option value="Archived">Archived</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <button
              type="submit"
              disabled={isSaving || isUploading}
              className="w-full bg-[#333] text-white py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSaving ? "Creating..." : "Create Product"}
            </button>
            <Link
              href="/admin/products"
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
