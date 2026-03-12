"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Upload,
  ChevronDown,
  X,
  Loader2,
  Sparkles,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm, useFieldArray } from "react-hook-form";
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
  images: z.array(z.string()).min(1, "At least one image is required"),
  tagline: z.string().optional(),
  schematicImage: z.string().optional(),
  specs: z.array(
    z.object({
      key: z.string().min(1, "Specification name is required"),
      value: z.string().min(1, "Specification value is required"),
    })
  ),
  showSpecs: z.boolean(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function AddProductPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [schematicFile, setSchematicFile] = useState<File | null>(null);
  const [schematicPreview, setSchematicPreview] = useState<string | null>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

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
      specs: [
        { key: "Material", value: "" },
        { key: "Finish", value: "" },
        { key: "Size", value: "" },
        { key: "Slip Rating", value: "" },
        { key: "Variation", value: "" },
        { key: "Suitability", value: "" },
        { key: "Rectified Edge", value: "" },
        { key: "Thickness", value: "" },
      ],
      showSpecs: true,
    },
  });

  const { fields: specFields, append: appendSpec, remove: removeSpec } = useFieldArray({
    control,
    name: "specs",
  });

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

      // Step 1.5: Upload schematic image if exists
      let schematicUrl = "";
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

      // Step 2: Create the product with the cloud image URLs
      const formData = new FormData();
      formData.append("name", data.name);
      formData.append("tagline", data.tagline || "");
      formData.append("description", data.description);
      formData.append("price", data.price.toString());
      formData.append("stock", data.stock.toString());
      formData.append("category", data.category);
      // Convert specs array to object
      const specsObj = data.specs.reduce((acc, current) => {
        if (current.key && current.value) {
          acc[current.key] = current.value;
        }
        return acc;
      }, {} as Record<string, string>);

      formData.append("specs", JSON.stringify(specsObj));
      formData.append("showSpecs", String(data.showSpecs));
      formData.append("images", JSON.stringify(uploadedUrls));
      formData.append("schematicImage", schematicUrl);

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

  const handleGenerateDescription = async () => {
    const name = watch("name");

    if (!name) {
      toast.error("Please enter a product name first");
      return;
    }

    if (selectedFiles.length === 0) {
      toast.error("Please upload at least one image first");
      return;
    }

    const file = selectedFiles[0];
    setIsGenerating(true);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64Image = reader.result as string;

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
      reader.onerror = () => {
        toast.error("Failed to read image file");
        setIsGenerating(false);
      };
    } catch (error: any) {
      toast.error(error.message || "Failed to process image");
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700 px-4 sm:px-0">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-primary/40">
        <Link
          href="/admin"
          className="hover:text-primary transition-colors"
          tabIndex={-1}
        >
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <Link
          href="/admin/products"
          className="hover:text-primary transition-colors"
          tabIndex={-1}
        >
          Products
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-primary truncate">New Product</span>
      </nav>

      {/* Header */}
      <header className="space-y-2 lg:space-y-3">
        <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
          New Product
        </h1>
        <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-80">
          Add a new product to the catalog.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12"
      >
        {/* Left Column: Product Information & Specs */}
        <div className="lg:col-span-2 space-y-8 lg:space-y-12">
          {/* Media Section */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
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
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-[#333]/10 rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-800 transition-opacity hover:bg-red-500 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <label
                className={cn(
                  "aspect-square bg-primary/5 border border-dashed border-primary/20 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-primary/10 transition-all group cursor-pointer",
                )}
              >
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Upload className="w-5 h-5 text-primary opacity-90 group-hover:opacity-100 transition-opacity" />
                <span className="text-[8px] uppercase tracking-widest font-bold text-primary opacity-80">
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
          {/* General Information */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-8 lg:space-y-10">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-primary font-bold">
                Product Information
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-80">
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
                  Tagline
                </label>
                <div className="input-standard">
                  <input
                    {...register("tagline")}
                    type="text"
                    placeholder="Short catchy tagline"
                    className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white"
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
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 lg:space-y-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-xl font-serif text-primary font-bold lowercase">
                  TECHNICAL <span className="uppercase">SPECIFICATIONS</span>
                </h2>
                <p className="text-[10px] uppercase tracking-widest opacity-80">
                  Define the characteristics of this piece.
                </p>
              </div>
              <label className="flex items-center cursor-pointer gap-3">
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-80">
                  Show on Product Page
                </span>
                <div className="relative">
                  <input type="checkbox" className="sr-only" {...register("showSpecs")} />
                  <div className={`block w-10 h-6 rounded-full transition-colors ${watch("showSpecs") ? "bg-primary" : "bg-gray-300"}`}></div>
                  <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${watch("showSpecs") ? "translate-x-4" : ""}`}></div>
                </div>
              </label>
            </div>

            <div className="space-y-6">
              {specFields.map((field, index) => (
                <div key={field.id} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  <div className="w-full sm:w-1/3 space-y-2">
                    <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-[#333]/60">
                      Name
                    </label>
                    <div className="input-standard">
                      <input
                        {...register(`specs.${index}.key` as const)}
                        placeholder="E.G. MATERIAL"
                        className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
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
                          className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-[#333] outline-none transition-all focus:bg-white"
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

          {/* Schematic Image Section */}
          <section className="bg-white p-6 lg:p-10 border border-primary/5 shadow-sm space-y-6 lg:space-y-8">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.4em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
              Technical Schematic Image
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {schematicPreview ? (
                <div className="relative aspect-square border border-[#333]/5 group w-full max-w-[200px]">
                  <img
                    src={schematicPreview}
                    alt="Schematic preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSchematicFile(null);
                      setSchematicPreview(null);
                    }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-[#333]/10 rounded-full flex items-center justify-center shadow-lg hover:bg-red-500 hover:text-white transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <label className="aspect-square bg-primary/5 border border-dashed border-primary/20 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-primary/10 transition-all group cursor-pointer w-full max-w-[200px]">
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
                section on the product page. Typically a blueprint or a
                dimension drawing.
              </p>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8">
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
                  className="w-full bg-secondary/10 px-4 py-3.5 lg:py-4 text-sm font-sans tracking-wide text-[#333] outline-none transition-all focus:bg-white appearance-none cursor-pointer"
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

          <div className="flex flex-col gap-4">
            <button
              type="submit"
              disabled={isSaving || isUploading}
              className="w-full bg-[#1a1a1a] text-primary py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin border-primary" />}
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
