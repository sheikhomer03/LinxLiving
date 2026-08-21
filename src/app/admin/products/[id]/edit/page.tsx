/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/incompatible-library */
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
} from "@/app/actions/admin";
import { notifyCatalogChange } from "@/lib/live-sync";
import { ProductExtrasFields } from "@/components/admin/ProductExtrasFields";
import { ProductFeaturePackingFields } from "@/components/admin/ProductFeaturePackingFields";
import { ProductColorFields } from "@/components/admin/ProductColorFields";
import { ProductSizeFields } from "@/components/admin/ProductSizeFields";
import { ProductPookyFields } from "@/components/admin/ProductPookyFields";
import { ProductUfhsSectionsFields } from "@/components/admin/ProductUfhsSectionsFields";
import { ProductDownloadFields } from "@/components/admin/ProductDownloadFields";
import { ProductFilesDocumentationFields } from "@/components/admin/ProductFilesDocumentationFields";
import { ProductBritmetDocsFields } from "@/components/admin/ProductBritmetDocsFields";
import { ProductSuitabilityFields } from "@/components/admin/ProductSuitabilityFields";
import { ProductOttoSectionsFields } from "@/components/admin/ProductOttoSectionsFields";
import { MultiSupplierFields } from "@/components/admin/MultiSupplierFields";
import { ComplianceCertificatesField } from "@/components/admin/ComplianceCertificatesField";
import {
  calculateSellPrice,
  defaultMarginForCategory,
} from "@/lib/pricingEngine";
import { LINX_DEPARTMENTS } from "@/lib/catalogueTaxonomy";
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
  // Optional — without a category the product syncs to Shopify as Draft (not Active)
  category: z.string().optional(),
  subCategory: z.string().optional(),
  department: z.string().optional(),
  brand: z.string().min(1, "Brand is required"),
  subBrand: z.string().optional(),
  supplier: z.string().optional(),
  linxSku: z.string().optional(),
  supplierSku: z.string().optional(),
  manufacturerSku: z.string().optional(),
  costPrice: z.number().nullable().optional(),
  importCost: z.number().nullable().optional(),
  deliveryCost: z.number().nullable().optional(),
  dutyCost: z.number().nullable().optional(),
  packagingCost: z.number().nullable().optional(),
  handlingCost: z.number().nullable().optional(),
  overheadCost: z.number().nullable().optional(),
  marginPercent: z.number().nullable().optional(),
  vatRate: z.number().nullable().optional(),
  leadTimeDays: z.number().nullable().optional(),
  warranty: z.string().optional(),
  complianceCertificates: z.array(z.string()).optional(),
  images: z.array(z.string()).min(1, "At least one image is required"),
  tagline: z.string().optional(),
  schematicImage: z.string().optional(),
  specs: z.array(
    z.object({
      key: z.string().min(1, "Specification name is required"),
      value: z.string().min(1, "Specification value is required"),
    }),
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
  sizeOptions: z
    .array(
      z.object({
        name: z.string(),
        imageUrl: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .optional(),
  coverage: z
    .object({
      label: z.string().optional(),
      helptext: z.string().optional(),
      values: z
        .array(
          z.object({
            name: z.string(),
            imageUrl: z.string().optional(),
            priceAdjustment: z.number().optional(),
            sku: z.string().optional(),
            sortOrder: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  nestedOptions: z.array(z.any()).optional(),
  doTheJobRight: z
    .object({
      label: z.string().optional(),
      helptext: z.string().optional(),
      items: z
        .array(
          z.object({
            name: z.string(),
            imageUrl: z.string().optional(),
            priceAdjustment: z.number().optional(),
            description: z.string().optional(),
            sortOrder: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  shopifyOptions: z.array(z.any()).optional(),
  bases: z
    .array(
      z.object({
        name: z.string(),
        images: z.array(z.string()).optional(),
        price: z.number().optional(),
        stock: z.number().optional(),
        handle: z.string().optional(),
        sku: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .optional(),
  shades: z
    .array(
      z.object({
        name: z.string(),
        images: z.array(z.string()).optional(),
        price: z.number().optional(),
        stock: z.number().optional(),
        handle: z.string().optional(),
        sku: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .optional(),
  pendants: z
    .array(
      z.object({
        name: z.string(),
        images: z.array(z.string()).optional(),
        price: z.number().optional(),
        stock: z.number().optional(),
        handle: z.string().optional(),
        sku: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .optional(),
  wallFittings: z
    .array(
      z.object({
        name: z.string(),
        images: z.array(z.string()).optional(),
        price: z.number().optional(),
        stock: z.number().optional(),
        handle: z.string().optional(),
        sku: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .optional(),
  efficiency: z
    .object({
      summary: z.string().optional(),
      details: z.string().optional(),
    })
    .optional(),
  downloads: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().optional(),
        type: z.string().optional(),
        iconUrl: z.string().optional(),
        children: z
          .array(z.object({ title: z.string(), url: z.string() }))
          .optional(),
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
  delivery: z.string().optional(),
  howItsMade: z.string().optional(),
  productAndSampleOrders: z.string().optional(),
  installationMaintenanceGuides: z
    .array(z.object({ name: z.string(), url: z.string().optional() }))
    .optional(),
  usage: z
    .array(
      z.object({
        title: z.string().optional(),
        image: z.string().optional(),
        checked: z.boolean().optional(),
      }),
    )
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
  const [schematicFile, setSchematicFile] = useState<File | null>(null);
  const [schematicPreview, setSchematicPreview] = useState<string | null>(null);
  const [existingSchematic, setExistingSchematic] = useState<string | null>(
    null,
  );
  const [menus, setMenus] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [filteredSubCategories, setFilteredSubCategories] = useState<any[]>([]);
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
      brand: "",
      subBrand: "",
      supplier: "",
      linxSku: "",
      supplierSku: "",
      manufacturerSku: "",
      costPrice: null,
      importCost: null,
      deliveryCost: null,
      dutyCost: null,
      packagingCost: null,
      handlingCost: null,
      overheadCost: null,
      marginPercent: null,
      vatRate: 20,
      leadTimeDays: null,
      warranty: "",
      complianceCertificates: [],
      category: "",
      subCategory: "",
      department: "",
      images: [],
      tagline: "",
      schematicImage: "",
      specs: [],
      featureEntries: [],
      packingEntries: [],
      showSpecs: true,
      installationGuide: "",
      insulatingSetPrice: null,
      flashingFinder: [],
      finishes: [],
      flashings: [],
      colorOptions: [],
      sizeOptions: [],
      coverage: { label: "Coverage", helptext: "", values: [] },
      nestedOptions: [],
      doTheJobRight: {
        label: "Do the Job Right - Tools and Testing Equipment",
        helptext: "",
        items: [],
      },
      shopifyOptions: [],
      bases: [],
      shades: [],
      pendants: [],
      wallFittings: [],
      efficiency: { summary: "", details: "" },
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
      delivery: "",
      howItsMade: "",
      productAndSampleOrders: "",
      installationMaintenanceGuides: [],
      usage: [],
    },
  });

  const selectedBrand = watch("brand");
  const selectedBrandSubBrands =
    brands.find((b) => String(b._id) === String(selectedBrand))?.subBrands ||
    [];
  const selectedCategory = watch("category");

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
  }, [selectedCategory, menus]);

  const {
    fields: specFields,
    append: appendSpec,
    remove: removeSpec,
  } = useFieldArray({
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

  // Fetch initial data on mount
  React.useEffect(() => {
    async function initialize() {
      try {
        const { getMenus, getBrands } = await import("@/app/actions/admin");
        const { getActiveSuppliers } = await import("@/app/actions/suppliers");
        const [product, menusRes, brandsRes, suppliersRes] = await Promise.all([
          getProduct(productId),
          getMenus(),
          getBrands(),
          getActiveSuppliers(),
        ]);

        if (!product) {
          toast.error("Product not found");
          router.push("/admin/products");
          return;
        }

        if (suppliersRes.success) {
          setSuppliers(suppliersRes.suppliers);
        }

        if (menusRes.success) {
          setMenus(menusRes.menus);
        }
        if (brandsRes.success) {
          setBrands(brandsRes.brands);
        }

        const menusList = menusRes.success ? menusRes.menus : [];
        const resolveBrandId = () => {
          if (product.brand) {
            return typeof product.brand === "object"
              ? String(product.brand._id || "")
              : String(product.brand);
          }
          const categoryMenu = menusList.find(
            (m: any) => m.slug === product.category,
          );
          if (categoryMenu?.brand) {
            return typeof categoryMenu.brand === "object"
              ? String(categoryMenu.brand._id || "")
              : String(categoryMenu.brand);
          }
          return "";
        };

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
          brand: resolveBrandId(),
          subBrand: product.subBrand || "",
          supplier: product.supplier
            ? typeof product.supplier === "object"
              ? String(product.supplier._id || "")
              : String(product.supplier)
            : "",
          linxSku: product.linxSku || "",
          supplierSku: product.supplierSku || "",
          manufacturerSku: product.manufacturerSku || "",
          costPrice:
            product.costPrice == null ? null : Number(product.costPrice),
          importCost:
            product.importCost == null ? null : Number(product.importCost),
          deliveryCost:
            product.deliveryCost == null
              ? null
              : Number(product.deliveryCost),
          dutyCost:
            product.dutyCost == null ? null : Number(product.dutyCost),
          packagingCost:
            product.packagingCost == null
              ? null
              : Number(product.packagingCost),
          handlingCost:
            product.handlingCost == null
              ? null
              : Number(product.handlingCost),
          overheadCost:
            product.overheadCost == null
              ? null
              : Number(product.overheadCost),
          marginPercent:
            product.marginPercent == null
              ? null
              : Number(product.marginPercent),
          vatRate:
            product.vatRate == null ? 20 : Number(product.vatRate),
          leadTimeDays:
            product.leadTimeDays == null ? null : Number(product.leadTimeDays),
          warranty: product.warranty || "",
          complianceCertificates: Array.isArray(product.complianceCertificates)
            ? product.complianceCertificates
            : [],
          category: product.category,
          subCategory: product.subCategory || "",
          department: product.department || "",
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
          featureEntries: Array.isArray(product.featureEntries)
            ? product.featureEntries.map((row: any) => ({
                key: String(row.label || row.key || ""),
                value: String(row.value || ""),
              }))
            : [],
          packingEntries: Array.isArray(product.packingEntries)
            ? product.packingEntries.map((row: any) => ({
                key: String(row.label || row.key || ""),
                value: String(row.value || ""),
              }))
            : [],
          installationGuide: product.installationGuide || "",
          insulatingSetPrice:
            product.insulatingSetPrice == null
              ? null
              : Number(product.insulatingSetPrice),
          flashingFinder: (product.flashingFinder || []).map((item: any) => ({
            title: item.title || "",
            description: item.description || "",
            imageUrl: item.imageUrl || item.image_url || "",
          })),
          finishes: (product.finishes || []).map((item: any) => ({
            name: item.name || "",
            imageUrl: item.imageUrl || item.image_url || "",
            priceAdjustment: Number(item.priceAdjustment ?? item.price_adjustment ?? 0),
          })),
          flashings: (product.flashings || []).map((item: any) => ({
            name: item.name || "",
            imageUrl: item.imageUrl || item.image_url || "",
            priceAdjustment: Number(item.priceAdjustment ?? item.price_adjustment ?? 0),
          })),
          colorOptions: Array.isArray(product.colorOptions)
            ? product.colorOptions.map((item: any, i: number) => ({
                name: item.name || "",
                swatchType: item.swatchType || "solid",
                colorValue: item.colorValue || "",
                swatchImage: item.swatchImage || "",
                imageUrl: item.imageUrl || item.image_url || "",
                sap: item.sap || "",
                sortOrder:
                  typeof item.sortOrder === "number" ? item.sortOrder : i,
              }))
            : [],
          sizeOptions: Array.isArray(product.sizeOptions)
            ? product.sizeOptions.map((item: any, i: number) => ({
                name: item.name || "",
                imageUrl: item.imageUrl || item.image_url || item.image || "",
                sortOrder:
                  typeof item.sortOrder === "number" ? item.sortOrder : i,
              }))
            : [],
          coverage: product.coverage || {
            label: "Coverage",
            helptext: "",
            values: [],
          },
          nestedOptions: Array.isArray(product.nestedOptions)
            ? product.nestedOptions
            : [],
          doTheJobRight: product.doTheJobRight || {
            label: "Do the Job Right - Tools and Testing Equipment",
            helptext: "",
            items: [],
          },
          shopifyOptions: Array.isArray(product.shopifyOptions)
            ? product.shopifyOptions
            : [],
          bases: Array.isArray(product.bases)
            ? product.bases.map((item: any, i: number) => ({
                name: item.name || "",
                images: Array.isArray(item.images)
                  ? item.images
                  : item.imageUrl
                    ? [item.imageUrl]
                    : [],
                price: Number(item.price) || 0,
                stock: Number(item.stock) || 0,
                handle: item.handle || "",
                sku: item.sku || "",
                sortOrder:
                  typeof item.sortOrder === "number" ? item.sortOrder : i,
              }))
            : [],
          shades: Array.isArray(product.shades)
            ? product.shades.map((item: any, i: number) => ({
                name: item.name || "",
                images: Array.isArray(item.images)
                  ? item.images
                  : item.imageUrl
                    ? [item.imageUrl]
                    : [],
                price: Number(item.price) || 0,
                stock: Number(item.stock) || 0,
                handle: item.handle || "",
                sku: item.sku || "",
                sortOrder:
                  typeof item.sortOrder === "number" ? item.sortOrder : i,
              }))
            : [],
          pendants: Array.isArray(product.pendants)
            ? product.pendants.map((item: any, i: number) => ({
                name: item.name || "",
                images: Array.isArray(item.images)
                  ? item.images
                  : item.imageUrl
                    ? [item.imageUrl]
                    : [],
                price: Number(item.price) || 0,
                stock: Number(item.stock) || 0,
                handle: item.handle || "",
                sku: item.sku || "",
                sortOrder:
                  typeof item.sortOrder === "number" ? item.sortOrder : i,
              }))
            : [],
          wallFittings: Array.isArray(product.wallFittings)
            ? product.wallFittings.map((item: any, i: number) => ({
                name: item.name || "",
                images: Array.isArray(item.images)
                  ? item.images
                  : item.imageUrl
                    ? [item.imageUrl]
                    : [],
                price: Number(item.price) || 0,
                stock: Number(item.stock) || 0,
                handle: item.handle || "",
                sku: item.sku || "",
                sortOrder:
                  typeof item.sortOrder === "number" ? item.sortOrder : i,
              }))
            : [],
          efficiency: {
            summary: String(product.efficiency?.summary || "").trim(),
            details: String(product.efficiency?.details || "").trim(),
          },
          downloads: Array.isArray(product.downloads)
            ? product.downloads.map((item: any) => ({
                name: item.title || item.name || "",
                url: item.url || "",
                type: item.type || "pdf",
                iconUrl: item.iconUrl || "",
                children: Array.isArray(item.children)
                  ? item.children.map((c: any) => ({
                      title: String(c.title || "").trim(),
                      url: String(c.url || "").trim(),
                    }))
                  : [],
              }))
            : [],
          filesDocumentation: Array.isArray(product.filesDocumentation)
            ? product.filesDocumentation.map((section: any) => ({
                heading: section.heading || "",
                files: Array.isArray(section.files)
                  ? section.files.map((f: any) => ({
                      title: f.title || "",
                      url: f.url || "",
                      type: f.type || "pdf",
                    }))
                  : [],
              }))
            : [],
          brochures: Array.isArray(product.brochures)
            ? product.brochures.map((b: any) => ({
                name: b.name || b.title || "",
                url: b.url || "",
              }))
            : [],
          productRange: Array.isArray(product.productRange)
            ? product.productRange.map((r: any) => ({
                name: r.name || "",
                image: r.image || "",
                tableHeadings: Array.isArray(r.tableHeadings)
                  ? r.tableHeadings
                  : [],
                tableRows: Array.isArray(r.tableRows) ? r.tableRows : [],
              }))
            : [],
          caseStudies: Array.isArray(product.caseStudies)
            ? product.caseStudies.map((c: any) => ({
                name: c.name || "",
                coverImage: c.coverImage || "",
                file: c.file || "",
              }))
            : [],
          generalSpecification: {
            image: product.generalSpecification?.image || "",
            content: product.generalSpecification?.content || "",
          },
          installerGuides: Array.isArray(product.installerGuides)
            ? product.installerGuides.map((g: any) => ({
                name: g.name || "",
                url: g.url || "",
              }))
            : [],
          drawingEntries: Array.isArray(product.drawingEntries)
            ? product.drawingEntries.map((d: any) => ({
                ref: d.ref || "",
                description: d.description || "",
                files: Array.isArray(d.files)
                  ? d.files.map((f: any) => ({
                      name: f.name || "",
                      url: f.url || "",
                    }))
                  : [],
              }))
            : [],
          suitability: {
            type:
              product.suitability?.type === "table" ||
              product.suitability?.type === "image"
                ? product.suitability.type
                : product.suitability?.image
                  ? "image"
                  : Array.isArray(product.suitability?.tableRows) &&
                      product.suitability.tableRows.length
                    ? "table"
                    : "",
            image: product.suitability?.image || "",
            tableHeadings: Array.isArray(product.suitability?.tableHeadings)
              ? product.suitability.tableHeadings
              : [],
            tableRows: Array.isArray(product.suitability?.tableRows)
              ? product.suitability.tableRows
              : [],
          },
          delivery: product.delivery || "",
          howItsMade: product.howItsMade || "",
          productAndSampleOrders: product.productAndSampleOrders || "",
          installationMaintenanceGuides: Array.isArray(
            product.installationMaintenanceGuides,
          )
            ? product.installationMaintenanceGuides.map((g: any) => ({
                name: g.name || "",
                url: g.url || "",
              }))
            : [],
          usage: Array.isArray(product.usage)
            ? product.usage.map((u: any) => ({
                title: u.title || "",
                image: u.image || "",
                checked: u.checked !== false,
              }))
            : [],
        });

        if (product.category && menusList.length > 0) {
          const parentMenu = menusList.find(
            (m: any) => m.slug === product.category,
          );
          if (parentMenu) {
            setFilteredSubCategories(
              menusList.filter((m: any) => m.parent === parentMenu._id),
            );
          }
        }

        setExistingImages(product.images || []);
        setExistingSchematic(product.schematicImage || null);
      } catch (error) {
        console.error("Initialization error:", error);
        toast.error("Failed to load piece details");
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
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
      formData.append("category", data.category || "");
      formData.append("subCategory", data.subCategory || "");
      formData.append("department", data.department || "");
      formData.append("brand", data.brand);
      formData.append("subBrand", data.subBrand || "");
      formData.append("supplier", data.supplier || "");
      formData.append("linxSku", data.linxSku || "");
      formData.append("supplierSku", data.supplierSku || "");
      formData.append("manufacturerSku", data.manufacturerSku || "");
      formData.append(
        "costPrice",
        data.costPrice == null || Number.isNaN(data.costPrice)
          ? ""
          : String(data.costPrice),
      );
      formData.append(
        "importCost",
        data.importCost == null || Number.isNaN(data.importCost)
          ? ""
          : String(data.importCost),
      );
      formData.append(
        "deliveryCost",
        data.deliveryCost == null || Number.isNaN(data.deliveryCost)
          ? ""
          : String(data.deliveryCost),
      );
      formData.append(
        "dutyCost",
        data.dutyCost == null || Number.isNaN(data.dutyCost)
          ? ""
          : String(data.dutyCost),
      );
      formData.append(
        "packagingCost",
        data.packagingCost == null || Number.isNaN(data.packagingCost)
          ? ""
          : String(data.packagingCost),
      );
      formData.append(
        "handlingCost",
        data.handlingCost == null || Number.isNaN(data.handlingCost)
          ? ""
          : String(data.handlingCost),
      );
      formData.append(
        "overheadCost",
        data.overheadCost == null || Number.isNaN(data.overheadCost)
          ? ""
          : String(data.overheadCost),
      );
      formData.append(
        "marginPercent",
        data.marginPercent == null || Number.isNaN(data.marginPercent)
          ? ""
          : String(data.marginPercent),
      );
      formData.append(
        "vatRate",
        data.vatRate == null || Number.isNaN(data.vatRate)
          ? "20"
          : String(data.vatRate),
      );
      formData.append(
        "leadTimeDays",
        data.leadTimeDays == null || Number.isNaN(data.leadTimeDays)
          ? ""
          : String(data.leadTimeDays),
      );
      formData.append("warranty", data.warranty || "");
      formData.append(
        "complianceCertificates",
        JSON.stringify(data.complianceCertificates || []),
      );
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
      formData.append("images", JSON.stringify(allImages));
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
        "sizeOptions",
        JSON.stringify(
          (data.sizeOptions || [])
            .filter((s) => String(s.name || "").trim())
            .map((s, i) => ({
              name: String(s.name).trim(),
              imageUrl: s.imageUrl || "",
              sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : i,
            })),
        ),
      );
      formData.append("coverage", JSON.stringify(data.coverage || {}));
      formData.append(
        "nestedOptions",
        JSON.stringify(data.nestedOptions || []),
      );
      formData.append(
        "doTheJobRight",
        JSON.stringify(data.doTheJobRight || {}),
      );
      formData.append(
        "shopifyOptions",
        JSON.stringify(data.shopifyOptions || []),
      );
      formData.append(
        "bases",
        JSON.stringify(
          (data.bases || [])
            .filter((b) => String(b.name || "").trim())
            .map((b, i) => ({
              name: String(b.name).trim(),
              images: Array.isArray(b.images) ? b.images : [],
              price: Number(b.price) || 0,
              stock: Number(b.stock) || 0,
              handle: b.handle || "",
              sku: b.sku || "",
              sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : i,
            })),
        ),
      );
      formData.append(
        "shades",
        JSON.stringify(
          (data.shades || [])
            .filter((s) => String(s.name || "").trim())
            .map((s, i) => ({
              name: String(s.name).trim(),
              images: Array.isArray(s.images) ? s.images : [],
              price: Number(s.price) || 0,
              stock: Number(s.stock) || 0,
              handle: s.handle || "",
              sku: s.sku || "",
              sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : i,
            })),
        ),
      );
      formData.append(
        "pendants",
        JSON.stringify(
          (data.pendants || [])
            .filter((s) => String(s.name || "").trim())
            .map((s, i) => ({
              name: String(s.name).trim(),
              images: Array.isArray(s.images) ? s.images : [],
              price: Number(s.price) || 0,
              stock: Number(s.stock) || 0,
              handle: s.handle || "",
              sku: s.sku || "",
              sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : i,
            })),
        ),
      );
      formData.append(
        "wallFittings",
        JSON.stringify(
          (data.wallFittings || [])
            .filter((s) => String(s.name || "").trim())
            .map((s, i) => ({
              name: String(s.name).trim(),
              images: Array.isArray(s.images) ? s.images : [],
              price: Number(s.price) || 0,
              stock: Number(s.stock) || 0,
              handle: s.handle || "",
              sku: s.sku || "",
              sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : i,
            })),
        ),
      );
      formData.append(
        "efficiency",
        JSON.stringify({
          summary: String(data.efficiency?.summary || "").trim(),
          details: String(data.efficiency?.details || "").trim(),
        }),
      );
      formData.append(
        "downloads",
        JSON.stringify(
          (data.downloads || [])
            .filter(
              (d) =>
                String(d.name || "").trim() &&
                (String(d.url || "").trim() ||
                  (Array.isArray(d.children) && d.children.length > 0)),
            )
            .map((d) => ({
              title: String(d.name).trim(),
              url: String(d.url || "").trim(),
              type: d.type || "pdf",
              iconUrl: d.iconUrl || "",
              children: Array.isArray(d.children) ? d.children : [],
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
      formData.append("delivery", data.delivery || "");
      formData.append("howItsMade", data.howItsMade || "");
      formData.append(
        "productAndSampleOrders",
        data.productAndSampleOrders || "",
      );
      formData.append(
        "installationMaintenanceGuides",
        JSON.stringify(
          (data.installationMaintenanceGuides || [])
            .filter(
              (g) =>
                String(g.name || "").trim() && String(g.url || "").trim(),
            )
            .map((g) => ({
              name: String(g.name).trim(),
              url: String(g.url || "").trim(),
            })),
        ),
      );
      formData.append(
        "usage",
        JSON.stringify(
          (data.usage || [])
            .filter(
              (u) =>
                String(u.title || "").trim() || String(u.image || "").trim(),
            )
            .map((u) => ({
              title: String(u.title || "").trim(),
              image: String(u.image || "").trim(),
              checked: Boolean(u.checked),
            })),
        ),
      );

      const result = await updateProduct(productId, formData);
      if (result.success) {
        if (result.shopify?.synced) {
          toast.success("Product updated and synced to Shopify");
        } else if (result.shopify?.error) {
          toast.success("Product updated (Shopify sync failed — check Settings → Shopify)");
          toast.error(result.shopify.error);
        } else {
        toast.success("Product revised successfully");
        }
        notifyCatalogChange("products");
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
        notifyCatalogChange("products");
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
      <div className="min-h-150 flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-stone-800/20" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto admin-page pb-8 animate-in fade-in duration-300 px-4 sm:px-0 text-stone-800">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-primary/40">
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
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="space-y-2 lg:space-y-3">
          <h1 className="admin-page-title font-serif text-primary">
            Edit Product
          </h1>
          <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold opacity-80">
            Edit product details • REF: {productId}
          </p>
        </div>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-2.5 lg:gap-3 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] lg:tracking-[0.16em] font-bold text-red-600/60 hover:text-red-600 transition-colors w-fit"
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
        <div className="lg:col-span-2 admin-page">
          {/* General Information */}
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-sm space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg lg:text-xl font-serif text-primary font-bold">
                Product Information
              </h2>
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-80">
                Enter the basic details for the product.
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
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white border-b border-stone-200"
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
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white border-b border-stone-200"
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
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all min-h-30 lg:min-h-37.5 resize-none focus:bg-white border-b border-stone-200"
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
                      className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white border-b border-stone-200"
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
                      className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white border-b border-stone-200"
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
                      LINX SKU
                    </label>
                    <input
                      {...register("linxSku")}
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                      placeholder="Our product code"
                    />
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
                      Manufacturer SKU
                    </label>
                    <input
                      {...register("manufacturerSku")}
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                    />
                  </div>
                  {(
                    [
                      ["costPrice", "Cost price (£)"],
                      ["importCost", "Import cost (£)"],
                      ["deliveryCost", "Delivery cost (£)"],
                      ["dutyCost", "Duty (£)"],
                      ["packagingCost", "Packaging (£)"],
                      ["handlingCost", "Handling (£)"],
                      ["overheadCost", "Overheads (£)"],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field} className="space-y-2">
                      <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                        {label}
                      </label>
                      <input
                        {...register(field, {
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
                  ))}
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
                          const cat = watch("category");
                          let margin = Number(watch("marginPercent"));
                          if (!Number.isFinite(margin)) {
                            margin = defaultMarginForCategory(cat);
                            setValue("marginPercent", margin, {
                              shouldDirty: true,
                            });
                          }
                          const priced = calculateSellPrice({
                            costPrice: watch("costPrice"),
                            importCost: watch("importCost"),
                            deliveryCost: watch("deliveryCost"),
                            dutyCost: watch("dutyCost"),
                            packagingCost: watch("packagingCost"),
                            handlingCost: watch("handlingCost"),
                            overheadCost: watch("overheadCost"),
                            marginPercent: margin,
                            vatRate: watch("vatRate"),
                          });
                          if (priced.landedCostExVat <= 0) {
                            toast.error("Enter a cost stack first");
                            return;
                          }
                          setValue("price", priced.sellPriceExVat, {
                            shouldDirty: true,
                          });
                          toast.success(
                            `Sell £${priced.sellPriceExVat.toFixed(2)} ex VAT (landed £${priced.landedCostExVat.toFixed(2)}, margin ${priced.marginPercent}%)`,
                          );
                        }}
                        className="shrink-0 px-3 text-[9px] uppercase font-bold tracking-widest border border-primary/30 text-primary hover:bg-primary/5"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      VAT %
                    </label>
                    <input
                      {...register("vatRate", {
                        setValueAs: (v) =>
                          v === "" || v == null || Number.isNaN(Number(v))
                            ? 20
                            : Number(v),
                      })}
                      type="number"
                      step="0.1"
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                    />
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
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
                      Warranty
                    </label>
                    <input
                      {...register("warranty")}
                      className="w-full bg-secondary/10 px-4 py-2 text-sm outline-none focus:bg-white border-b border-stone-200"
                      placeholder="e.g. 5 years manufacturer warranty"
                    />
                  </div>
                  <ComplianceCertificatesField
                    value={watch("complianceCertificates") || []}
                    onChange={(urls) =>
                      setValue("complianceCertificates", urls, {
                        shouldDirty: true,
                      })
                    }
                  />
                </div>
                {productId ? (
                  <MultiSupplierFields
                    productId={productId}
                    suppliers={suppliers}
                  />
                ) : null}
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
                    <label className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
                      Name
                    </label>
                    <div className="input-standard">
                      <input
                        {...register(`specs.${index}.key` as const)}
                        placeholder="E.G. MATERIAL"
                        className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-stone-800 outline-none transition-all focus:bg-white border-b border-stone-200"
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
                          className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-stone-800 outline-none transition-all focus:bg-white border-b border-stone-200"
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

          {/* Media Section */}
          <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-sm space-y-6 lg:space-y-5">
            <h2 className="text-[9px] lg:text-[11px] uppercase tracking-[0.18em] lg:tracking-[0.5em] font-bold text-primary opacity-80 pb-4 lg:pb-6 border-b border-primary/10">
              Product Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
              {[...existingImages, ...previewUrls].map(
                (src: string, index: number) => (
                  <div
                    key={index}
                    className="aspect-square bg-secondary/10 relative group border border-stone-200/80 overflow-hidden"
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
                      className="absolute top-2 right-2 p-1.5 bg-red-600 text-white opacity-0 group-hover:opacity-800 transition-opacity duration-300 shadow-sm"
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

          <ProductSizeFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductUfhsSectionsFields
            control={control}
            register={register}
            setValue={setValue}
          />

          <ProductPookyFields
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

          <ProductOttoSectionsFields
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
              {schematicPreview || existingSchematic ? (
                <div className="relative aspect-square border border-stone-200/80 group w-full max-w-50">
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
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-stone-200 rounded-full flex items-center justify-center shadow-sm hover:bg-red-500 hover:text-white transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <label className="aspect-square bg-primary/5 border border-dashed border-primary/30 flex flex-col items-center justify-center gap-3 lg:gap-4 hover:bg-primary/10 transition-all group cursor-pointer w-full max-w-50">
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
                This image will be displayed in the &quot;Technical Specifications&quot;
                section on the product page.
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
                    {selectedCategory &&
                      !brandCategories.some((m) => m.slug === selectedCategory) && (
                        <option value={selectedCategory}>
                          {menus.find((m) => m.slug === selectedCategory)?.name ||
                            selectedCategory}{" "}
                          (current)
                        </option>
                      )}
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
                    className="w-full bg-secondary/10 px-4 py-2 text-sm font-sans tracking-wide text-stone-800 outline-none transition-all focus:bg-white appearance-none cursor-pointer disabled:opacity-30 border-b border-stone-200"
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

          <div className="flex flex-col gap-3 lg:gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full admin-btn-primary rounded-lg py-2 text-[10px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20"
            >
              {isSaving && (
                <Loader2 className="w-4 h-4 animate-spin border-primary" />
              )}
              {isSaving ? "Updating..." : "Update Product"}
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

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          {/* Backdrop */}
          <div
            className="absolute inset-0 admin-modal-overlay"
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

            <div className="p-8 md:p-12 text-center space-y-5">
              <div className="flex justify-center">
                <div className="w-12 h-12 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-90" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-lg font-serif tracking-widest uppercase text-stone-800">
                  Asset Purge
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Confirming the permanent removal of{" "}
                  <span className="font-bold text-stone-800">&quot;{productId}&quot;</span>.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.16em] font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Removal
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.12em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
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
