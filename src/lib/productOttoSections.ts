/** Otto Tiles–style PDP content blocks (Delivery, How It's Made, etc.). */

export type InstallationMaintenanceGuide = {
  name: string;
  url: string;
};

export type ProductUsageItem = {
  title: string;
  image: string;
  /** When true, show a tick icon on the PDP. */
  checked: boolean;
};

export function parseNamedGuides(raw: unknown): InstallationMaintenanceGuide[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const name = String(
        (row as any)?.name || (row as any)?.title || "",
      ).trim();
      const url = String((row as any)?.url || "").trim();
      return { name, url };
    })
    .filter((r) => r.name && r.url);
}

export function parseUsageItems(raw: unknown): ProductUsageItem[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const title = String((row as any)?.title || "").trim();
      const image = String((row as any)?.image || (row as any)?.imageUrl || "").trim();
      const checked = Boolean((row as any)?.checked);
      return { title, image, checked };
    })
    .filter((r) => r.title || r.image);
}

export function hasUsageItems(
  items: ProductUsageItem[] | null | undefined,
): boolean {
  return Array.isArray(items) && items.some((i) => i.image || i.title);
}

export function trimRichText(value: unknown): string {
  return String(value || "").trim();
}
