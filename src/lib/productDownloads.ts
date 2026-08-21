export type ProductDownloadChild = {
  title: string;
  url: string;
};

export type ProductDownloadItem = {
  title: string;
  url: string;
  type: "pdf" | "drawing" | "install" | "certificate" | "other";
  iconUrl: string;
  children: ProductDownloadChild[];
};

function inferType(title: string, url: string): ProductDownloadItem["type"] {
  const t = `${title} ${url}`.toLowerCase();
  if (/install/i.test(t)) return "install";
  if (/cert|warrant|garant/i.test(t)) return "certificate";
  if (/2d|3d|dwg|cad|drawing|fbx|obj|max/i.test(t)) return "drawing";
  if (/\.pdf($|\?)/i.test(url) || /pdf/i.test(t)) return "pdf";
  return "other";
}

export function parseProductDownloads(raw: unknown): ProductDownloadItem[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: ProductDownloadItem[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const title = String((row as any).title || (row as any).name || "").trim();
    const url = String((row as any).url || "").trim();
    const children = Array.isArray((row as any).children)
      ? (row as any).children
          .map((c: any) => ({
            title: String(c?.title || c?.name || "").trim(),
            url: String(c?.url || "").trim(),
          }))
          .filter((c: ProductDownloadChild) => c.title && c.url)
      : [];
    if (!title) continue;
    if (!url && !children.length) continue;
    const typeRaw = String((row as any).type || "").trim().toLowerCase();
    const type = (
      ["pdf", "drawing", "install", "certificate", "other"].includes(typeRaw)
        ? typeRaw
        : inferType(title, url)
    ) as ProductDownloadItem["type"];
    out.push({
      title,
      url: url || children[0]?.url || "",
      type,
      iconUrl: String((row as any).iconUrl || (row as any).icon_url || "").trim(),
      children,
    });
  }
  return out;
}
