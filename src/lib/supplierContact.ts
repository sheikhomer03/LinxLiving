/** Normalize phone to digits for wa.me (keeps leading country code). */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Keep leading + as country hint then strip non-digits
  const digits = s.replace(/[^\d]/g, "");
  return digits;
}

export function whatsappHref(
  phoneOrWhatsapp: string | null | undefined,
  message?: string,
): string | null {
  const n = normalizeWhatsAppNumber(phoneOrWhatsapp);
  if (!n) return null;
  const base = `https://wa.me/${n}`;
  if (message?.trim()) {
    return `${base}?text=${encodeURIComponent(message.trim())}`;
  }
  return base;
}

export function mailtoHref(
  email: string | null | undefined,
  opts?: { subject?: string; body?: string },
): string | null {
  const e = String(email || "").trim();
  if (!e || !e.includes("@")) return null;
  const params = new URLSearchParams();
  if (opts?.subject) params.set("subject", opts.subject);
  if (opts?.body) params.set("body", opts.body);
  const q = params.toString();
  return q ? `mailto:${e}?${q}` : `mailto:${e}`;
}

export function websiteHref(url: string | null | undefined): string | null {
  const u = String(url || "").trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

export function telHref(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  return `tel:${digits}`;
}

/** Suggested retail from cost + margin % (ex VAT). */
export function suggestedSellPrice(
  cost: number | null | undefined,
  marginPercent: number | null | undefined,
): number | null {
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return null;
  const m = Number(marginPercent);
  if (!Number.isFinite(m)) return Math.round(c * 100) / 100;
  return Math.round(c * (1 + m / 100) * 100) / 100;
}

export type SupplierContact = {
  _id?: string;
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  logo?: string;
  contactName?: string;
  notes?: string;
  defaultLeadTimeDays?: number | null;
};
