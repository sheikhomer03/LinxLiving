export type KeyValueEntry = { label: string; value: string };

/** Normalize optional Features / Packing rows from admin FormData JSON. */
export function parseKeyValueEntries(raw: unknown): KeyValueEntry[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: KeyValueEntry[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const label = String(
      (row as any).label ?? (row as any).key ?? "",
    ).trim();
    const value = String((row as any).value ?? "").trim();
    if (!label || !value) continue;
    out.push({ label, value });
  }
  return out;
}

export function normalizeFeatureValue(value: string): string {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Porcelanosa hides empty / placeholder feature values. */
export function isUsableFeatureValue(value: string): boolean {
  const v = normalizeFeatureValue(value).toUpperCase();
  return Boolean(v) && v !== "-" && v !== "NO APLICA" && v !== "#";
}
