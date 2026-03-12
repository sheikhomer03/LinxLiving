"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
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
  X,
  ChevronRight,
  Upload,
  ChevronDown,
  Trash2,
  Sparkles,
  Plus,
  AlertCircle,
} from "lucide-react";
import Image from "next/image";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  price: z.number().min(0, "Price must be positive"),
  stock: z.number().min(0, "Stock must be positive"),
  category: z.string().min(1, "Category is required"),
  images: z.array(z.string()).min(1, "At least one image is required"),
  tagline: z.string().optional(),
  schematicImage: z.string().optional(),
  specs: z.array(
    z.object({
      key: z.string().min(1, "Specification name is required"),
      value: z.string().min(1, "Specification value is required"),
    }),
  ),
  showSpecs: z.boolean(),
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
  const [schematicFile, setSchematicFile] = useState<File | null>(null);
  const [schematicPreview, setSchematicPreview] = useState<string | null>(null);
  const [existingSchematic, setExistingSchematic] = useState<string | null>(
    null,
  );
  const [collections, setCollections] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    watch,
    control,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema) as any,
    defaultValues: {
      name: "",
      description: "",
      price: 0,
      stock: 0,
      category: "",
      images: [],
      tagline: "",
      schematicImage: "",
      specs: [],
      showSpecs: true,
    },
  });

  const {
    fields: specFields,
    append: appendSpec,
    remove: removeSpec,
  } = useFieldArray({
    control,
    name: "specs",
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
        // Convert specs object to array for form
        const specsArray = product.specs
          ? Object.entries(product.specs).map(([key, value]) => ({
              key,
              value: String(value),
            }))
          : [];

        reset({
          name: product.name,
          description: product.description,
          price: product.price,
          stock: product.stock,
          category: product.category,
          images: product.images || [],
          tagline: product.tagline || "",
          schematicImage: product.schematicImage || "",
          specs:
            specsArray.length > 0
              ? specsArray
              : [
                  { key: "Material", value: "" },
                  { key: "Finish", value: "" },
                  { key: "Size", value: "" },
                  { key: "Slip Rating", value: "" },
                  { key: "Variation", value: "" },
                  { key: "Suitability", value: "" },
                  { key: "Rectified Edge", value: "" },
                  { key: "Thickness", value: "" },
                ],
          showSpecs: product.showSpecs !== undefined ? product.showSpecs : true,
        });
        setExistingImages(product.images || []);
        setExistingSchematic(product.schematicImage || null);
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

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);

    // Check for file sizes
    const oversizedFiles = newFiles.filter((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      toast.error(`Some files exceed the 10MB limit and were skipped.`);
      return;
    }

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

      // Step 1.5: Upload schematic image if a new one is selected
      let schematicUrl = existingSchematic || "";
      if (schematicFile) {
        const fd = new FormData();
        fd.append("file", schematicFile);
        const res = await fetch("/api/admin/upload", {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || !json.url) {
          throw new Error(json.error || "Schematic image upload failed");
        }
        schematicUrl = json.url;
      }

      // Step 2: Combine existing and new image URLs
      const allImages = [...existingImages, ...newImageUrls];

      // Step 3: Update the product with the combined image URLs
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("tagline", data.tagline || "");
      formData.append("description", data.description);
      formData.append("price", data.price.toString());
      formData.append("stock", data.stock.toString());
      formData.append("category", data.category);
      // Convert specs array to object
      const specsObj = data.specs.reduce(
        (acc, current) => {
          if (current.key && current.value) {
            acc[current.key] = current.value;
          }
          return acc;
        },
        {} as Record<string, string>,
      );

      formData.append("specs", JSON.stringify(specsObj));
      formData.append("showSpecs", String(data.showSpecs));
      formData.append("images", JSON.stringify(allImages));
      formData.append("schematicImage", schematicUrl);

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

  const handleGenerateDescription = async () => {
    const name = watch("name");

    if (!name) {
      toast.error("Please enter a product name first");
      return;
    }

    let base64Image = "";

    if (selectedFiles.length > 0) {
      // Use the new file
      const file = selectedFiles[0];
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        base64Image = base64;
      } catch (error) {
        toast.error("Failed to read new image file");
        return;
      }
    } else if (existingImages.length > 0) {
      // Use existing image URL
      base64Image = existingImages[0];
    } else {
      toast.error("Please upload or ensure at least one image exists");
      return;
    }

    setIsGenerating(true);

    try {
      const res = await fetch("/api/admin/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, imageUrl: base64Image }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setValue("description", data.description, { shouldValidate: true });
      toast.success("Description generated successfully!");
    } catch (error: any) {
      toast.error(error.message || "Failed to generate description");
    } finally {
      setIsGenerating(false);
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
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-primary/40">
        <Link href="/admin" className="hover:text-primary transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <Link
          href="/admin/products"
          className="hover:text-primary transition-colors"
        >
          Products
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary truncate">Edit Product</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-8">
        <div className="space-y-2 lg:space-y-3">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
            Edit Product
          </h1>
          <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-80">
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
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-primary font-bold">
                Product Information
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-80">
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
                  Tagline
                </label>
                <div className="input-standard">
                  <input
                    {...register("tagline")}
                    type="text"
                    placeholder="Short catchy tagline"
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
                  />
                </div>
              </div>

              <div className="space-y-2 lg:space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                    Description
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateDescription}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-bold text-primary hover:text-black transition-colors disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-primary" />
                    )}
                    {isGenerating ? "Generating..." : "Auto-Generate with AI"}
                  </button>
                </div>
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
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 lg:space-y-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-serif text-primary font-bold lowercase">
                  TECHNICAL <span className="uppercase">SPECIFICATIONS</span>
                </h2>
                <p className="text-[10px] uppercase tracking-widest opacity-80">
                  Refine the technical characteristics.
                </p>
              </div>
              <label className="flex items-center cursor-pointer gap-3">
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-80">
                  Show on Product Page
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    {...register("showSpecs")}
                  />
                  <div
                    className={`block w-10 h-6 rounded-full transition-colors ${watch("showSpecs") ? "bg-primary" : "bg-gray-300"}`}
                  ></div>
                  <div
                    className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${watch("showSpecs") ? "translate-x-4" : ""}`}
                  ></div>
                </div>
              </label>
            </div>

            <div className="space-y-6">
              {specFields.map((field, index) => (
                <div
                  key={field.id}
                  className="flex flex-col sm:flex-row gap-4 items-start sm:items-center"
                >
                  <div className="w-full sm:w-1/3 space-y-2">
                    <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-[#333]/60">
                      Name
                    </label>
                    <div className="input-standard">
                      <input
                        {...register(`specs.${index}.key` as const)}
                        placeholder="E.G. MATERIAL"
                        className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
                      />
                    </div>
                    {errors.specs?.[index]?.key && (
                      <p className="text-[9px] text-red-500 uppercase tracking-widest">
                        {errors.specs[index].key?.message}
                      </p>
                    )}
                  </div>
                  <div className="w-full sm:w-2/3 space-y-2 relative">
                    <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-[#333]/60">
                      Value
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="input-standard flex-1">
                        <input
                          {...register(`specs.${index}.value` as const)}
                          placeholder="E.G. POLISHED PORCELAIN"
                          className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white border-b border-[#333]/10"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSpec(index)}
                        className="p-3 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        title="Remove Specification"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {errors.specs?.[index]?.value && (
                      <p className="text-[9px] text-red-500 uppercase tracking-widest">
                        {errors.specs[index].value?.message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-primary/10">
                <button
                  type="button"
                  onClick={() => appendSpec({ key: "", value: "" })}
                  className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold text-primary hover:text-black transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Specification
                </button>
              </div>
            </div>
          </section>

          {/* Media Section */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
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
                      className="absolute top-2 right-2 p-1.5 bg-red-600 text-white opacity-0 group-hover:opacity-800 transition-opacity duration-300 shadow-lg"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ),
              )}
              <label className="aspect-square bg-primary/5 border border-dashed border-primary/30 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-primary/10 transition-all group cursor-pointer relative overflow-hidden">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <Upload className="w-4 h-4 lg:w-5 lg:h-5 text-primary opacity-90 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[7.5px] lg:text-[8px] uppercase tracking-widest font-bold text-primary opacity-80">
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

          {/* Schematic Image Section */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
              Technical Schematic Image
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {schematicPreview || existingSchematic ? (
                <div className="relative aspect-square border border-[#333]/5 group w-full max-w-[200px]">
                  <img
                    src={schematicPreview || existingSchematic || ""}
                    alt="Schematic preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSchematicFile(null);
                      setSchematicPreview(null);
                      setExistingSchematic(null);
                    }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-[#333]/10 rounded-full flex items-center justify-center shadow-lg hover:bg-red-500 hover:text-white transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <label className="aspect-square bg-primary/5 border border-dashed border-primary/30 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-primary/10 transition-all group cursor-pointer w-full max-w-[200px]">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > MAX_FILE_SIZE) {
                          toast.error("Schematic file exceeds the 4MB limit.");
                          return;
                        }
                        setSchematicFile(file);
                        setSchematicPreview(URL.createObjectURL(file));
                      }
                    }}
                    className="hidden"
                  />
                  <Upload className="w-5 h-5 text-primary opacity-90 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[8px] uppercase tracking-widest font-bold text-primary opacity-80">
                    Upload Schematic
                  </span>
                </label>
              )}
              <p className="text-[10px] text-[#333]/40 leading-relaxed uppercase tracking-widest">
                This image will be displayed in the "Technical Specifications"
                section on the product page.
              </p>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8 ">
          {/* Organization & Status */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-6">
            <div className="space-y-1">
              <h2 className="text-sm lg:text-[11px] font-bold tracking-widest uppercase text-primary opacity-80">
                Categorization
              </h2>
            </div>

            <div className="space-y-3">
              <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/60">
                Select Category
              </label>
              <div className="input-standard">
                <select
                  {...register("category")}
                  className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white appearance-none cursor-pointer border-b border-[#333]/10"
                >
                  <option value="">SELECT A CATEGORY</option>
                  <option value="baths">STONE BATHS</option>
                  <option value="vanity-units">VANITY UNITS</option>
                  <option value="basins">BASINS</option>
                  <option value="mirrors">MIRRORS</option>
                  <option value="accessories">ACCESSORIES</option>
                  {collections.length > 0 && (
                    <>
                      {collections.map((coll) => (
                        <option key={coll._id} value={coll.slug}>
                          {coll.name.toUpperCase()}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
              {errors.category && (
                <p className="text-[9px] text-red-500 uppercase tracking-widest">
                  {errors.category.message}
                </p>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-3 lg:gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-[#1a1a1a] text-primary py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20"
            >
              {isSaving && (
                <Loader2 className="w-4 h-4 animate-spin border-primary" />
              )}
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
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg disabled:opacity-80 flex items-center justify-center gap-3"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Removal
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
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
