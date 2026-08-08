/** Product Suitability block — either a table or an image (not both). */

export type SuitabilityType = "" | "table" | "image";

export type ProductSuitability = {
  type: SuitabilityType;
  image: string;
  tableHeadings: string[];
  tableRows: string[][];
};

export function emptySuitability(): ProductSuitability {
  return {
    type: "",
    image: "",
    tableHeadings: [],
    tableRows: [],
  };
}

export function parseSuitability(raw: unknown): ProductSuitability {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "{}");
    } catch {
      return emptySuitability();
    }
  }
  if (!raw || typeof raw !== "object") return emptySuitability();
  const typeRaw = String((raw as any).type || "").trim().toLowerCase();
  const type: SuitabilityType =
    typeRaw === "table" || typeRaw === "image" ? typeRaw : "";
  const image = String((raw as any).image || "").trim();
  const tableHeadings = Array.isArray((raw as any).tableHeadings)
    ? (raw as any).tableHeadings.map((h: unknown) => String(h || "").trim())
    : [];
  const tableRows = Array.isArray((raw as any).tableRows)
    ? (raw as any).tableRows
        .filter((r: unknown) => Array.isArray(r))
        .map((r: unknown[]) => r.map((c) => String(c || "").trim()))
    : [];

  if (type === "image" && image) {
    return { type: "image", image, tableHeadings: [], tableRows: [] };
  }
  if (type === "table" && (tableHeadings.length || tableRows.length)) {
    return { type: "table", image: "", tableHeadings, tableRows };
  }
  // Infer from content when type missing (legacy / scrape)
  if (image && !tableRows.length) {
    return { type: "image", image, tableHeadings: [], tableRows: [] };
  }
  if (tableRows.length) {
    return { type: "table", image: "", tableHeadings, tableRows };
  }
  return emptySuitability();
}

export function hasSuitability(
  value: ProductSuitability | null | undefined,
): boolean {
  if (!value) return false;
  if (value.type === "image") return Boolean(value.image);
  if (value.type === "table") return (value.tableRows || []).length > 0;
  return Boolean(value.image) || (value.tableRows || []).length > 0;
}
