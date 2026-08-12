/** Porcelanosa-style Files and Documentation (headed sections). */

export type FilesDocumentationFile = {
  title: string;
  url: string;
  type: "pdf" | "zip" | "other";
};

export type FilesDocumentationSection = {
  heading: string;
  files: FilesDocumentationFile[];
};

export function parseFilesDocumentation(raw: unknown): FilesDocumentationSection[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: FilesDocumentationSection[] = [];
  for (const section of parsed) {
    if (!section || typeof section !== "object") continue;
    const heading = String(
      (section as any).heading || (section as any).title || "",
    ).trim();
    const filesRaw = Array.isArray((section as any).files)
      ? (section as any).files
      : [];
    const files: FilesDocumentationFile[] = [];
    for (const f of filesRaw) {
      if (!f || typeof f !== "object") continue;
      const title = String((f as any).title || (f as any).name || "").trim();
      const url = String((f as any).url || "").trim();
      if (!title || !url) continue;
      const typeRaw = String((f as any).type || "").toLowerCase();
      const type: FilesDocumentationFile["type"] =
        typeRaw === "pdf" || typeRaw === "zip" || typeRaw === "other"
          ? typeRaw
          : /\.zip($|\?)/i.test(url)
            ? "zip"
            : /\.pdf($|\?)/i.test(url) || /pdf/i.test(title)
              ? "pdf"
              : "other";
      files.push({ title, url, type });
    }
    if (!heading || !files.length) continue;
    out.push({ heading, files });
  }
  return out;
}
