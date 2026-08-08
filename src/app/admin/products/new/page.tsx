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
import { createProduct } from "@/app/actions/admin";
import { cn } from "@/lib/utils";
import { notifyCatalogChange } from "@/lib/live-sync";
import { ProductExtrasFields } from "@/components/admin/ProductExtrasFields";
import { ProductFeaturePackingFields } from "@/components/admin/ProductFeaturePackingFields";
import { ProductColorFields } from "@/components/admin/ProductColorFields";
import { ProductDownloadFields } from "@/components/admin/ProductDownloadFields";
import { ProductFilesDocumentationFields } from "@/components/admin/ProductFilesDocumentationFields";
import { ProductBritmetDocsFields } from "@/components/admin/ProductBritmetDocsFields";
import { ProductSuitabilityFields } from "@/components/admin/ProductSuitabilityFields";
import { LINX_DEPARTMENTS } from "@/lib/catalogueTaxonomy";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  price: z.number().min(0, "Price must be positive"),
  stock: z.number().min(0, "Stock must be positive"),
  // Optional — without a category the product syncs to Shopify as Draft (not Active)
  category: z.string().optional(),
  subCategory: z.string().optional(),
  department: z.string().optional(),
  brand: z.string().min(1, "Brand is required"),
  subBrand: z.string().optional(),
  supplier: z.string().optional(),
  supplierSku: z.string().optional(),
  costPrice: z.number().nullable().optional(),
  marginPercent: z.number().nullable().optional(),
  leadTimeDays: z.number().nullable().optional(),
  images: z.array(z.string()).min(1, "At least one image is required"),
  tagline: z.string().optional(),
  schematicImage: z.string().optional(),
  specs: z.array(
    z.object({
      key: z.string().min(1, "Specification name is required"),
      value: z.string().min(1, "Specification value is required"),
    })
  ),
  featureEntries: z
    .array(
      z.object({
        key: z.string().optional(),
        value: z.string().optional(),
      }),
    )
    .optional(),
  packingEntries: z
    .array(
      z.object({
        key: z.string().optional(),
        value: z.string().optional(),
      }),
    )
    .optional(),
  showSpecs: z.boolean(),
  installationGuide: z.string().optional(),
  insulatingSetPrice: z.number().nullable().optional(),
  flashingFinder: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
      }),
    )
    .optional(),
  finishes: z
    .array(
      z.object({
        name: z.string(),
        imageUrl: z.string().optional(),
        priceAdjustment: z.number().optional(),
      }),
    )
    .optional(),
  flashings: z
    .array(
      z.object({
        name: z.string(),
        imageUrl: z.string().optional(),
        priceAdjustment: z.number().optional(),
      }),
    )
    .optional(),
  colorOptions: z
    .array(
      z.object({
        name: z.string(),
        swatchType: z.enum(["solid", "gradient", "image"]).optional(),
        colorValue: z.string().optional(),
        swatchImage: z.string().optional(),
        imageUrl: z.string().optional(),
        sap: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .optional(),
  downloads: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().optional(),
        type: z.string().optional(),
        iconUrl: z.string().optional(),
      }),
    )
    .optional(),
  filesDocumentation: z
    .array(
      z.object({
        heading: z.string(),
        files: z
          .array(
            z.object({
              title: z.string(),
              url: z.string().optional(),
              type: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  brochures: z
    .array(z.object({ name: z.string(), url: z.string().optional() }))
    .optional(),
  productRange: z
    .array(
      z.object({
        name: z.string(),
        image: z.string().optional(),
        tableHeadings: z.array(z.string()).optional(),
        tableRows: z.array(z.array(z.string())).optional(),
      }),
    )
    .optional(),
  caseStudies: z
    .array(
      z.object({
        name: z.string(),
        coverImage: z.string().optional(),
        file: z.string().optional(),
      }),
    )
    .optional(),
  generalSpecification: z
    .object({ image: z.string().optional(), content: z.string().optional() })
    .optional(),
  installerGuides: z
    .array(z.object({ name: z.string(), url: z.string().optional() }))
    .optional(),
  drawingEntries: z
    .array(
      z.object({
        ref: z.string().optional(),
        description: z.string().optional(),
        files: z
          .array(z.object({ name: z.string(), url: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  suitability: z
    .object({
      type: z.enum(["", "table", "image"]).optional(),
      image: z.string().optional(),
      tableHeadings: z.array(z.string()).optional(),
      tableRows: z.array(z.array(z.string())).optional(),
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
  const [schematicFile, setSchematicFile] = useState<File | null>(null);
  const [schematicPreview, setSchematicPreview] = useState<string | null>(null);
  const [menus, setMenus] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [filteredSubCategories, setFilteredSubCategories] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  React.useEffect(() => {
    async function loadData() {
      try {
        const { getMenus, getBrands } = await import("@/app/actions/admin");
        const { getActiveSuppliers } = await import("@/app/actions/suppliers");
        const [menusResult, brandsResult, suppliersResult] = await Promise.all([
          getMenus(),
          getBrands(),
          getActiveSuppliers(),
        ]);
        if (menusResult.success) {
          setMenus(menusResult.menus);
        }
        if (brandsResult.success) {
          setBrands(brandsResult.brands);
        }
        if (suppliersResult.success) {
          setSuppliers(suppliersResult.suppliers);
        }
      } catch (error) {
        toast.error("Failed to load brands and categories");
      }
    }
    loadData();
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
      brand: "",
      subBrand: "",
      supplier: "",
      supplierSku: "",
      costPrice: null,
      marginPercent: null,
      leadTimeDays: null,
      category: "",
      subCategory: "",
      department: "",
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
      featureEntries: [],
      packingEntries: [],
      installationGuide: "",
      insulatingSetPrice: null,
      flashingFinder: [],
      finishes: [],
      flashings: [],
      colorOptions: [],
      downloads: [],
      filesDocumentation: [],
      brochures: [],
      productRange: [],
      caseStudies: [],
      generalSpecification: { image: "", content: "" },
      installerGuides: [],
      drawingEntries: [],
      suitability: {
        type: "",
        image: "",
        tableHeadings: [],
        tableRows: [],
      },
    },
  });

  const selectedBrand = watch("brand");
  const selectedCategory = watch("category");
  const selectedBrandSubBrands =
    brands.find((b) => String(b._id) === String(selectedBrand))?.subBrands ||
    [];

  const menuBrandId = (menu: any) => {
    if (!menu?.brand) return "";
    return typeof menu.brand === "object"
      ? String(menu.brand._id || "")
      : String(menu.brand);
  };

  const brandCategories = menus.filter(
    (m) => !m.parent && selectedBrand && menuBrandId(m) === selectedBrand,
  );

  React.useEffect(() => {
    if (selectedCategory) {
      const parentMenu = menus.find((m) => m.slug === selectedCategory);
      if (parentMenu) {
        const subs = menus.filter((m) => m.parent === parentMenu._id);
        setFilteredSubCategories(subs);
      } else {
        setFilteredSubCategories([]);
      }
    } else {
      setFilteredSubCategories([]);
    }
    setValue("subCategory", "");
  }, [selectedCategory, menus, setValue]);

  const { fields: specFields, append: appendSpec, remove: removeSpec } = useFieldArray({
    control,
    name: "specs",
  });
  const {
    fields: featureFields,
    append: appendFeature,
    remove: removeFeature,
  } = useFieldArray({
    control,
    name: "featureEntries",
  });
  const {
    fields: packingFields,
    append: appendPacking,
    remove: removePacking,
  } = useFieldArray({
    control,
    name: "packingEntries",
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
      formData.append("category", data.category || "");
      formData.append("subCategory", data.subCategory || "");
      formData.append("department", data.department || "");
      formData.append("brand", data.brand);
      formData.append("subBrand", data.subBrand || "");
      formData.append("supplier", data.supplier || "");
      formData.append("supplierSku", data.supplierSku || "");
      formData.append(
        "costPrice",
        data.costPrice == null || Number.isNaN(data.costPrice)
          ? ""
          : String(data.costPrice),
      );
      formData.append(
        "marginPercent",
        data.marginPercent == null || Number.isNaN(data.marginPercent)
          ? ""
          : String(data.marginPercent),
      );
      formData.append(
        "leadTimeDays",
        data.leadTimeDays == null || Number.isNaN(data.leadTimeDays)
          ? ""
          : String(data.leadTimeDays),
      );
      // Convert specs array to object
      const specsObj = data.specs.reduce((acc, current) => {
        if (current.key && current.value) {
          acc[current.key] = current.value;
        }
        return acc;
      }, {} as Record<string, string>);

      formData.append("specs", JSON.stringify(specsObj));
      formData.append(
        "featureEntries",
        JSON.stringify(
          (data.featureEntries || [])
            .filter((r) => String(r.key || "").trim() && String(r.value || "").trim())
            .map((r) => ({
              label: String(r.key).trim(),
              value: String(r.value).trim(),
            })),
        ),
      );
      formData.append(
        "packingEntries",
        JSON.stringify(
          (data.packingEntries || [])
            .filter((r) => String(r.key || "").trim() && String(r.value || "").trim())
            .map((r) => ({
              label: String(r.key).trim(),
              value: String(r.value).trim(),
            })),
        ),
      );
      formData.append("showSpecs", String(data.showSpecs));
      formData.append("images", JSON.stringify(uploadedUrls));
      formData.append("schematicImage", schematicUrl);
      formData.append("installationGuide", data.installationGuide || "");
      formData.append(
        "insulatingSetPrice",
        data.insulatingSetPrice == null || Number.isNaN(data.insulatingSetPrice)
          ? ""
          : String(data.insulatingSetPrice),
      );
      formData.append(
        "flashingFinder",
        JSON.stringify(data.flashingFinder || []),
      );
      formData.append("finishes", JSON.stringify(data.finishes || []));
      formData.append("flashings", JSON.stringify(data.flashings || []));
      formData.append(
        "colorOptions",
        JSON.stringify(
          (data.colorOptions || [])
            .filter((c) => String(c.name || "").trim())
            .map((c, i) => ({
              name: String(c.name).trim(),
              swatchType: c.swatchType || "solid",
              colorValue: c.colorValue || "",
              swatchImage: c.swatchImage || "",
              imageUrl: c.imageUrl || "",
              sap: c.sap || "",
              sortOrder: typeof c.sortOrder === "number" ? c.sortOrder : i,
            })),
        ),
      );
      formData.append(
        "downloads",
        JSON.stringify(
          (data.downloads || [])
            .filter(
              (d) =>
                String(d.name || "").trim() && String(d.url || "").trim(),
            )
            .map((d) => ({
              title: String(d.name).trim(),
              url: String(d.url || "").trim(),
              type: d.type || "pdf",
              iconUrl: d.iconUrl || "",
              children: [],
            })),
        ),
      );
      formData.append(
        "filesDocumentation",
        JSON.stringify(
          (data.filesDocumentation || [])
            .map((section) => ({
              heading: String(section.heading || "").trim(),
              files: (section.files || [])
                .filter(
                  (f) =>
                    String(f.title || "").trim() &&
                    String(f.url || "").trim(),
                )
                .map((f) => ({
                  title: String(f.title).trim(),
                  url: String(f.url || "").trim(),
                  type: f.type || "pdf",
                })),
            }))
            .filter((s) => s.heading && s.files.length),
        ),
      );
      formData.append("brochures", JSON.stringify(data.brochures || []));
      formData.append("productRange", JSON.stringify(data.productRange || []));
      formData.append("caseStudies", JSON.stringify(data.caseStudies || []));
      formData.append(
        "generalSpecification",
        JSON.stringify(data.generalSpecification || { image: "", content: "" }),
      );
      formData.append(
        "installerGuides",
        JSON.stringify(data.installerGuides || []),
      );
      formData.append(
        "drawingEntries",
        JSON.stringify(data.drawingEntries || []),
      );
      formData.append(
        "suitability",
        JSON.stringify(
          data.suitability || {
            type: "",
            image: "",
            tableHeadings: [],
            tableRows: [],
          },
        ),
      );

      const result = await createProduct(formData);
      if (result.success) {
        if (result.shopify?.synced) {
          toast.success("Product created and synced to Shopify");
        } else if (result.shopify?.error) {
          toast.success("Product created (Shopify sync failed — check Settings → Shopify)");
          toast.error(result.shopify.error);
        } else {
          toast.success("Product created successfully");
        }
        notifyCatalogChange("products");
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
    <div className="max-w-6xl mx-auto admin-page pb-8 animate-in fade-in duration-300 px-4 sm:px-0">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-primary/40">
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
        <h1 className="admin-page-title font-serif text-primary">
          New Product
        </h1>
        <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold opacity-80">
          Add a new product to the catalog.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12"
      >
        {/* Left Column: Product Information & Specs */}
        <div className="lg:col-span-2 admin-page">
          {/* Media Section */}
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-sm space-y-6 lg:space-y-5">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.18em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
              Product Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
              {previewUrls.map((url: string, index: number) => (
                <div
                  key={index}
                  className="relative aspect-square border border-stone-200/80 group"
                >
                  <img
                    src={url}
                    alt={`Product image ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-stone-200 rounded-full flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-800 transition-opacity hover:bg-red-500 hover:text-white"
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
                <Upload className="w-4 h-4 text-primary opacity-90 group-hover:opacity-100 transition-opacity" />
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
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-sm space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-primary font-bold">
                Product Information
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-80">
                Enter the basic details for the new product.
              </p>
            </div>

            <div className="space-y-6 lg:space-y-5">
              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                  Name
                </label>
                <div className="input-standard">
                  <input
                    {...register("name")}
                    type="text"
                    placeholder="Product name"
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white"
                  />
                </div>
                {errors.name && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 lg:space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                  Tagline
                </label>
                <div className="input-standard">
                  <input
                    {...register("tagline")}
                    type="text"
                    placeholder="Short catchy tagline"
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white"
                  />
                </div>
              </div>

              <div className="space-y-2 lg:space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
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
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all min-h-[120px] lg:min-h-[150px] resize-none focus:bg-white"
                  />
                </div>
                {errors.description && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2 lg:space-y-3">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                    Price (£)
                  </label>
                  <div className="input-standard">
                    <input
                      {...register("price", { valueAsNumber: true })}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white"
                    />
                  </div>
                  {errors.price && (
                    <p className="text-[9px] text-red-500 uppercase tracking-widest">
                      {errors.price.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2 lg:space-y-3">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                    Stock
                  </label>
                  <div className="input-standard">
                    <input
                      {...register("stock", { valueAsNumber: true })}
                      type="number"
                      placeholder="0"
                      className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white"
                    />
                  </div>
                  {errors.stock && (
                    <p className="text-[9px] text-red-500 uppercase tracking-widest">
                      {errors.stock.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-stone-100 space-y-3">
                <p className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500">
                  Supplier &amp; costing
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      Supplier (override brand default)
                    </label>
                    <select
                      {...register("supplier")}
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                    >
                      <option value="">Use brand default</option>
                      {suppliers.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      Supplier SKU
                    </label>
                    <input
                      {...register("supplierSku")}
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                      placeholder="Supplier product code"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      Cost price (£)
                    </label>
                    <input
                      {...register("costPrice", {
                        setValueAs: (v) =>
                          v === "" || v == null || Number.isNaN(Number(v))
                            ? null
                            : Number(v),
                      })}
                      type="number"
                      step="0.01"
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      Margin %
                    </label>
                    <div className="flex gap-2">
                      <input
                        {...register("marginPercent", {
                          setValueAs: (v) =>
                            v === "" || v == null || Number.isNaN(Number(v))
                              ? null
                              : Number(v),
                        })}
                        type="number"
                        step="0.1"
                        className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const cost = Number(watch("costPrice"));
                          const margin = Number(watch("marginPercent"));
                          if (!Number.isFinite(cost) || cost < 0) {
                            toast.error("Enter a cost price first");
                            return;
                          }
                          const m = Number.isFinite(margin) ? margin : 0;
                          const sell =
                            Math.round(cost * (1 + m / 100) * 100) / 100;
                          setValue("price", sell, { shouldDirty: true });
                          toast.success(`Sell price set to £${sell}`);
                        }}
                        className="shrink-0 px-3 text-[9px] uppercase font-bold tracking-widest border border-primary/30 text-primary hover:bg-primary/5"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      Lead time (days)
                    </label>
                    <input
                      {...register("leadTimeDays", {
                        setValueAs: (v) =>
                          v === "" || v == null || Number.isNaN(Number(v))
                            ? null
                            : Number(v),
                      })}
                      type="number"
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Technical Specifications */}
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-5">
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
                    <label className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
                      Name
                    </label>
                    <div className="input-standard">
                      <input
                        {...register(`specs.${index}.key` as const)}
                        placeholder="E.G. MATERIAL"
                        className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-stone-800 outline-none transition-all focus:bg-white"
                      />
                    </div>
                    {errors.specs?.[index]?.key && (
                      <p className="text-[9px] text-red-500 uppercase tracking-widest">
                        {errors.specs[index].key?.message}
                      </p>
                    )}
                  </div>
                  <div className="w-full sm:w-2/3 space-y-2 relative">
                    <label className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
                      Value
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="input-standard flex-1">
                        <input
                          {...register(`specs.${index}.value` as const)}
                          placeholder="E.G. POLISHED PORCELAIN"
                          className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-stone-800 outline-none transition-all focus:bg-white"
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
                  className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Specification
                </button>
              </div>
            </div>
          </section>

          <ProductFeaturePackingFields
            title="FEATURES"
            hint="Optional — Porcelanosa-style feature rows (FAMILY, CLASS, …)."
            fields={featureFields}
            register={register}
            name="featureEntries"
            onAppend={() => appendFeature({ key: "", value: "" })}
            onRemove={removeFeature}
          />

          <ProductFeaturePackingFields
            title="PACKING"
            hint="Optional — packing / sale-unit rows from the supplier sheet."
            fields={packingFields}
            register={register}
            name="packingEntries"
            onAppend={() => appendPacking({ key: "", value: "" })}
            onRemove={removePacking}
          />

          <ProductColorFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductDownloadFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductFilesDocumentationFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductBritmetDocsFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductSuitabilityFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductExtrasFields
            control={control as never}
            register={register as never}
          />

          {/* Schematic Image Section */}
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-sm space-y-6 lg:space-y-5">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.18em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
              Technical Schematic Image
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {schematicPreview ? (
                <div className="relative aspect-square border border-stone-200/80 group w-full max-w-[200px]">
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
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-stone-200 rounded-full flex items-center justify-center shadow-sm hover:bg-red-500 hover:text-white transition-all"
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
                  <Upload className="w-4 h-4 text-primary opacity-90 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[8px] uppercase tracking-widest font-bold text-primary opacity-80">
                    Upload Schematic
                  </span>
                </label>
              )}
              <p className="text-[10px] text-stone-400 leading-relaxed uppercase tracking-widest">
                This image will be displayed in the "Technical Specifications"
                section on the product page. Typically a blueprint or a
                dimension drawing.
              </p>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-5">
          {/* Organization & Status */}
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-sm space-y-6">
            <div className="space-y-1">
              <h2 className="text-sm lg:text-[11px] font-bold tracking-widest uppercase text-primary opacity-80">
                Categorization
              </h2>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                  Brand
                </label>
                <div className="input-standard">
                  <select
                    {...register("brand", {
                      onChange: () => {
                        setValue("category", "");
                        setValue("subCategory", "");
                        setValue("subBrand", "");
                        setFilteredSubCategories([]);
                      },
                    })}
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white appearance-none cursor-pointer border-b border-stone-200"
                  >
                    <option value="">Select a brand</option>
                    {brands.map((brand) => (
                      <option key={brand._id} value={brand._id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </div>
                {errors.brand && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.brand.message}
                  </p>
                )}
              </div>

              {selectedBrandSubBrands.length > 0 && (
                <div className="space-y-3">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                    Sub-brand (optional)
                  </label>
                  <div className="input-standard">
                    <select
                      {...register("subBrand")}
                      className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white appearance-none cursor-pointer border-b border-stone-200"
                    >
                      <option value="">None</option>
                      {selectedBrandSubBrands.map((sb: any) => (
                        <option key={sb.slug} value={sb.slug}>
                          {sb.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                  Department
                </label>
                <div className="input-standard">
                  <select
                    {...register("department")}
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white appearance-none cursor-pointer border-b border-stone-200"
                  >
                    <option value="">Unassigned</option>
                    {LINX_DEPARTMENTS.map((dept) => (
                      <option key={dept.slug} value={dept.slug}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                  Main Category
                </label>
                <div className="input-standard">
                  <select
                    {...register("category", {
                      onChange: () => {
                        setValue("subCategory", "");
                      },
                    })}
                    disabled={!selectedBrand}
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white appearance-none cursor-pointer border-b border-stone-200 disabled:opacity-40"
                  >
                    <option value="">
                      {!selectedBrand
                        ? "Select a brand first"
                        : "None (Shopify Draft)"}
                    </option>
                    {brandCategories.map((menu) => (
                      <option key={menu._id} value={menu.slug}>
                        {menu.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[9px] text-stone-400 uppercase tracking-widest">
                  Without a category, product stays Draft in Shopify
                </p>
                {errors.category && (
                  <p className="text-[9px] text-red-500 uppercase tracking-widest">
                    {errors.category.message}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-stone-500">
                  Sub Category
                </label>
                <div className="input-standard">
                  <select
                    {...register("subCategory")}
                    disabled={!selectedCategory || filteredSubCategories.length === 0}
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white appearance-none cursor-pointer disabled:opacity-30"
                  >
                    <option value="">
                      {filteredSubCategories.length > 0
                        ? "Select a sub category"
                        : "No sub categories"}
                    </option>
                    {filteredSubCategories.map((menu) => (
                      <option key={menu._id} value={menu.slug}>
                        {menu.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <button
              type="submit"
              disabled={isSaving || isUploading}
              className="w-full admin-btn-primary rounded-lg py-2 text-[10px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin border-primary" />}
              {isSaving ? "Creating..." : "Create Product"}
            </button>
            <Link
              href="/admin/products"
              className="block w-full text-center border border-stone-200 py-2 text-[10px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold hover:bg-secondary/30 transition-all text-stone-800"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
