"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  getProduct,
  updateProduct,
  deleteProduct,
  getCollections,
} from "@/app/actions/admin";
import {
  Loader2,
  Plus,
  X,
  ChevronRight,
  Upload,
  ChevronDown,
  Trash2,
  AlertCircle,
} from "lucide-react";
import Image from "next/image";

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

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const productId = unwrappedParams.id;
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [collections, setCollections] = useState<any[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
  });

  // Fetch product data on mount
  React.useEffect(() => {
    async function loadProduct() {
      try {
        const product = await getProduct(productId);
        if (!product) {
          toast.error("Product not found");
          router.push("/admin/products");
          return;
        }
        reset({
          name: product.name,
          description: product.description,
          price: product.price,
          stock: product.stock,
          category: product.category,
          status: product.status || "Published Archive",
          images: product.images || [],
          specs: product.specs || {},
        });
        setExistingImages(product.images || []);
      } catch (error) {
        toast.error("Failed to load product");
      } finally {
        setIsLoading(false);
      }
    }

    async function loadCollections() {
      try {
        const data = await getCollections();
        setCollections(data);
      } catch (error) {
        console.error("Failed to load collections");
      }
    }

    loadProduct();
    loadCollections();
  }, [productId, reset, router]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...newFiles]);

    const newPreviews = newFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls((prev) => [...prev, ...newPreviews]);

    // Update form value to pass validation
    setValue("images", [...existingImages, ...previewUrls, ...newPreviews], {
      shouldValidate: true,
    });
  };

  const removeImage = (index: number) => {
    if (index < existingImages.length) {
      const newExisting = existingImages.filter((_, i) => i !== index);
      setExistingImages(newExisting);
      setValue("images", [...newExisting, ...previewUrls], {
        shouldValidate: true,
      });
    } else {
      const newIndex = index - existingImages.length;
      const newFiles = selectedFiles.filter((_, i) => i !== newIndex);
      const newPreviews = previewUrls.filter((_, i) => i !== newIndex);

      URL.revokeObjectURL(previewUrls[newIndex]);

      setSelectedFiles(newFiles);
      setPreviewUrls(newPreviews);
      setValue("images", [...existingImages, ...newPreviews], {
        shouldValidate: true,
      });
    }
  };

  const onSubmit = async (data: ProductFormValues) => {
    setIsSaving(true);
    try {
      // Step 1: Upload any new image files via the API route
      const newImageUrls: string[] = [];
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
        newImageUrls.push(json.url);
      }

      // Step 2: Combine existing and new image URLs
      const allImages = [...existingImages, ...newImageUrls];

      // Step 3: Update the product with the combined image URLs
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("description", data.description);
      formData.append("price", data.price.toString());
      formData.append("stock", data.stock.toString());
      formData.append("category", data.category);
      formData.append("status", data.status);
      formData.append("specs", JSON.stringify(data.specs));
      formData.append("images", JSON.stringify(allImages));

      const result = await updateProduct(productId, formData);
      if (result.success) {
        toast.success("Product revised successfully");
        router.push("/admin/products");
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to revise product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteProduct(productId);
      if (result.success) {
        toast.success("Asset purged from registry");
        router.push("/admin/products");
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete product");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[600px] flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-[#333]/20" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700 px-4 sm:px-0 text-[#333]">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/40">
        <Link href="/admin" className="hover:text-[#333] transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <Link
          href="/admin/products"
          className="hover:text-[#333] transition-colors"
        >
          Products
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-[#333] truncate">Edit Product</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-8">
        <div className="space-y-2 lg:space-y-3">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
            Edit Product
          </h1>
          <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-40">
            Edit product details • REF: {productId}
          </p>
        </div>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-2.5 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-red-600/60 hover:text-red-600 transition-colors w-fit"
        >
          <Trash2 className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
          Delete Product
        </button>
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
                Enter the basic details for the product.
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
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
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
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all min-h-[120px] lg:min-h-[150px] resize-none focus:bg-white border-b border-[#333]/10"
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
                      className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
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
                      className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
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
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-[#333] font-bold lowercase">
                TECHNICAL <span className="uppercase">SPECIFICATIONS</span>
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-40">
                Refine the technical characteristics.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12 gap-y-6 lg:gap-y-8">
              {[
                { name: "material", label: "Material" },
                { name: "finish", label: "Finish" },
                { name: "size", label: "Size" },
                { name: "slipRating", label: "Slip Rating" },
                { name: "variation", label: "Variation" },
                { name: "suitability", label: "Suitability" },
                { name: "rectifiedEdge", label: "Rectified Edge" },
                { name: "thickness", label: "Thickness" },
              ].map((spec) => (
                <div key={spec.name} className="space-y-2">
                  <label className="text-[9px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                    {spec.label}
                  </label>
                  <div className="input-standard">
                    <input
                      {...register(`specs.${spec.name}` as any)}
                      placeholder={`${spec.label} specification`}
                      className="w-full bg-secondary/10 px-4 py-3 text-[10px] lg:text-[11px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Media Section */}
          <section className="bg-white p-6 lg:p-10 border border-[#333]/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-[#333] opacity-40 pb-4 lg:pb-6 border-b border-[#333]/5">
              Product Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
              {[...existingImages, ...previewUrls].map(
                (src: string, index: number) => (
                  <div
                    key={index}
                    className="aspect-square bg-secondary/10 relative group border border-[#333]/5 overflow-hidden"
                  >
                    <Image
                      src={src}
                      alt={`Product ${index + 1}`}
                      fill
                      className="object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute top-2 right-2 p-1.5 bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-lg"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ),
              )}
              <label className="aspect-square bg-secondary/10 border border-dashed border-[#333]/20 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-secondary/20 transition-all group cursor-pointer relative overflow-hidden">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <Upload className="w-4 h-4 lg:w-5 lg:h-5 opacity-20 group-hover:opacity-40 transition-opacity" />
                  <span className="text-[7.5px] lg:text-[8px] uppercase tracking-widest font-bold opacity-40">
                    Upload
                  </span>
                </div>
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
            <h2 className="text-lg lg:text-xl font-serif font-bold text-[#333]">
              Organization
            </h2>

            <div className="space-y-5 lg:space-y-6 text-[#333]">
              <div className="space-y-2 lg:space-y-3 relative group">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-60">
                  Category
                </label>
                <div className="relative">
                  <select
                    {...register("category")}
                    className="w-full bg-secondary/10 border-b border-[#333]/10 px-4 py-3.5 lg:py-4 text-[11px] lg:text-[12px] uppercase tracking-[0.1em] lg:tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none text-[#333]"
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
              </div>

              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-60">
                  Status
                </label>
                <div className="relative group">
                  <select
                    {...register("status")}
                    className="w-full bg-secondary/10 border-b border-[#333]/10 px-4 py-3.5 lg:py-4 text-[11px] lg:text-[12px] uppercase tracking-[0.1em] lg:tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none text-[#333]"
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

          <div className="flex flex-col gap-3 lg:gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-[#333] text-white py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSaving ? "Updating..." : "Update Product"}
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
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-60" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-[#333]">
                  Asset Purge
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Confirming the permanent removal of{" "}
                  <span className="font-bold text-[#333]">"{productId}"</span>.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Removal
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 hover:opacity-100 transition-opacity pt-2"
                >
                  Keep Asset
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
