import type { ComponentProps } from "react";
import type { ProductCard } from "@/components/products/ProductCard";
import type { VisualiserDesign } from "@/lib/visualiser/flooring";

/** The ProductCard props the visualiser's design grid fills in. */
export type VisualiserCardData = Pick<
  ComponentProps<typeof ProductCard>,
  | "id"
  | "slug"
  | "name"
  | "price"
  | "category"
  | "subCategory"
  | "department"
  | "brandName"
  | "brandSlug"
  | "priceMode"
  | "pricePerM2"
  | "size"
  | "hasPaidSample"
  | "salePercent"
  | "compareAtPrice"
  | "vatRate"
  | "image"
  | "images"
  | "shopifyImages"
  | "stock"
  | "shopifyVariantId"
>;

/** One row of /api/visualiser/designs: how to lay it, and how to sell it. */
export type VisualiserDesignCard = {
  design: VisualiserDesign;
  card: VisualiserCardData;
};

export type VisualiserDesignsResponse = {
  designs: VisualiserDesignCard[];
  page: number;
  total: number;
  totalPages: number;
};

/** A surface from the scanner, as the engine reads it. */
export type ScannedSurface = {
  name: string;
  label?: string;
  product_surface: "floor" | "wall" | "ceiling" | string;
  realSize?: { w: number; h: number };
  [key: string]: unknown;
};

/** /api/visualiser/scan's successful response. */
export type ScanResponse = {
  width: number;
  height: number;
  objectList: ScannedSurface[];
  camera?: Record<string, unknown>;
  scan?: Record<string, unknown>;
};
