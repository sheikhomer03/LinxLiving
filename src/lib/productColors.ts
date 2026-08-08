import type { CSSProperties } from "react";

/** Optional product colour / finish variants (Noken-style swatches). */

export type ProductColorOption = {
  name: string;
  /** `solid` | `gradient` | `image` — how the swatch is rendered. */
  swatchType: "solid" | "gradient" | "image";
  /** CSS colour or gradient (e.g. `#111` or `linear-gradient(...)`). */
  colorValue: string;
  /** Optional swatch icon URL (Noken acabado icons). */
  swatchImage: string;
  /** Product photo for this colour. */
  imageUrl: string;
  /** Optional SAP / article code. */
  sap: string;
  sortOrder: number;
};

export function emptyColorOption(
  partial?: Partial<ProductColorOption>,
): ProductColorOption {
  return {
    name: "",
    swatchType: "solid",
    colorValue: "#cccccc",
    swatchImage: "",
    imageUrl: "",
    sap: "",
    sortOrder: 0,
    ...partial,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function parseColorOptions(raw: unknown): ProductColorOption[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  const out: ProductColorOption[] = [];
  for (const [index, row] of asArray<any>(parsed).entries()) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.name || "").trim();
    if (!name) continue;
    const swatchImage = String(row.swatchImage || row.swatch_image || "").trim();
    const colorValue = String(row.colorValue || row.color_value || "").trim();
    let swatchType = String(row.swatchType || row.swatch_type || "")
      .trim()
      .toLowerCase();
    if (swatchType !== "solid" && swatchType !== "gradient" && swatchType !== "image") {
      if (swatchImage && !colorValue) swatchType = "image";
      else if (/gradient/i.test(colorValue)) swatchType = "gradient";
      else swatchType = "solid";
    }
    out.push({
      name,
      swatchType: swatchType as ProductColorOption["swatchType"],
      colorValue:
        colorValue ||
        (swatchType === "solid" ? "#cccccc" : ""),
      swatchImage,
      imageUrl: String(row.imageUrl || row.image_url || "").trim(),
      sap: String(row.sap || "").trim(),
      sortOrder:
        typeof row.sortOrder === "number"
          ? row.sortOrder
          : typeof row.sort_order === "number"
            ? row.sort_order
            : index,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** CSS background for a swatch circle/square. */
export function colorSwatchStyle(option: ProductColorOption): CSSProperties {
  if (option.swatchType === "image" && option.swatchImage) {
    return {
      backgroundImage: `url(${option.swatchImage})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (option.swatchImage && !option.colorValue) {
    return {
      backgroundImage: `url(${option.swatchImage})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (option.colorValue) {
    return { background: option.colorValue };
  }
  if (option.swatchImage) {
    return {
      backgroundImage: `url(${option.swatchImage})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: "#e5e5e5" };
}
