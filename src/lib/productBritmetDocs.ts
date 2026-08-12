/** Britmet-style product documentation tabs (brochure, range, case studies, …). */

export type NamedFile = {
  name: string;
  url: string;
};

export type ProductRangeItem = {
  name: string;
  image: string;
  tableHeadings: string[];
  tableRows: string[][];
};

export type CaseStudyItem = {
  name: string;
  coverImage: string;
  file: string;
};

export type GeneralSpecification = {
  image: string;
  content: string;
};

export type DrawingEntry = {
  ref: string;
  description: string;
  files: NamedFile[];
};

export type ProductBritmetDocs = {
  brochures: NamedFile[];
  productRange: ProductRangeItem[];
  caseStudies: CaseStudyItem[];
  generalSpecification: GeneralSpecification;
  installerGuides: NamedFile[];
  drawingEntries: DrawingEntry[];
};

export function emptyBritmetDocs(): ProductBritmetDocs {
  return {
    brochures: [],
    productRange: [],
    caseStudies: [],
    generalSpecification: { image: "", content: "" },
    installerGuides: [],
    drawingEntries: [],
  };
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseNamedFiles(raw: unknown): NamedFile[] {
  const out: NamedFile[] = [];
  for (const row of asArray(raw)) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as any).name || (row as any).title || "").trim();
    const url = String((row as any).url || (row as any).file || "").trim();
    if (!name || !url) continue;
    out.push({ name, url });
  }
  return out;
}

export function parseProductRange(raw: unknown): ProductRangeItem[] {
  const out: ProductRangeItem[] = [];
  for (const row of asArray(raw)) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as any).name || "").trim();
    const image = String((row as any).image || (row as any).imageUrl || "").trim();
    if (!name && !image) continue;
    const tableHeadings = Array.isArray((row as any).tableHeadings)
      ? (row as any).tableHeadings.map((h: unknown) => String(h || "").trim())
      : [];
    const tableRows = Array.isArray((row as any).tableRows)
      ? (row as any).tableRows
          .filter((r: unknown) => Array.isArray(r))
          .map((r: unknown[]) => r.map((c) => String(c || "").trim()))
      : [];
    out.push({ name, image, tableHeadings, tableRows });
  }
  return out;
}

export function parseCaseStudies(raw: unknown): CaseStudyItem[] {
  const out: CaseStudyItem[] = [];
  for (const row of asArray(raw)) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as any).name || (row as any).title || "").trim();
    const coverImage = String(
      (row as any).coverImage || (row as any).image || "",
    ).trim();
    const file = String((row as any).file || (row as any).url || "").trim();
    if (!name) continue;
    out.push({ name, coverImage, file });
  }
  return out;
}

export function parseGeneralSpecification(raw: unknown): GeneralSpecification {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "{}");
    } catch {
      return { image: "", content: String(raw || "").trim() };
    }
  }
  if (!raw || typeof raw !== "object") return { image: "", content: "" };
  return {
    image: String((raw as any).image || "").trim(),
    content: String((raw as any).content || "").trim(),
  };
}

export function parseDrawingEntries(raw: unknown): DrawingEntry[] {
  const out: DrawingEntry[] = [];
  for (const row of asArray(raw)) {
    if (!row || typeof row !== "object") continue;
    const ref = String((row as any).ref || "").trim();
    const description = String((row as any).description || "").trim();
    const files = parseNamedFiles((row as any).files);
    if (!ref && !description && !files.length) continue;
    out.push({ ref, description, files });
  }
  return out;
}

export function parseBritmetDocsFromForm(formData: FormData): {
  brochures: NamedFile[];
  productRange: ProductRangeItem[];
  caseStudies: CaseStudyItem[];
  generalSpecification: GeneralSpecification;
  installerGuides: NamedFile[];
  drawingEntries: DrawingEntry[];
} {
  return {
    brochures: parseNamedFiles(formData.get("brochures")),
    productRange: parseProductRange(formData.get("productRange")),
    caseStudies: parseCaseStudies(formData.get("caseStudies")),
    generalSpecification: parseGeneralSpecification(
      formData.get("generalSpecification"),
    ),
    installerGuides: parseNamedFiles(formData.get("installerGuides")),
    drawingEntries: parseDrawingEntries(formData.get("drawingEntries")),
  };
}

export function hasBritmetDocs(docs: Partial<ProductBritmetDocs> | null | undefined) {
  if (!docs) return false;
  return Boolean(
    (docs.brochures || []).length ||
      (docs.productRange || []).length ||
      (docs.caseStudies || []).length ||
      String(docs.generalSpecification?.content || "").trim() ||
      String(docs.generalSpecification?.image || "").trim() ||
      (docs.installerGuides || []).length ||
      (docs.drawingEntries || []).length,
  );
}
