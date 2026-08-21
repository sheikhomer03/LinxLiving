/**
 * Customer support contact details.
 *
 * Read from Settings so the number and address can be changed in admin
 * without a deploy — the phone number was previously hardcoded in two places
 * in the navbar. The constants below are only the fallback for a store that
 * has not filled them in yet.
 *
 * Nothing here changes an existing flow: every support surface is additive.
 */

import { unstable_cache } from "next/cache";

// Fallbacks live in @/lib/company so client components can read them without
// pulling the Settings model into the browser bundle.
export {
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_HOURS,
} from "@/lib/company";
import {
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_HOURS,
} from "@/lib/company";

export type SupportContact = {
  phone: string;
  /** Same number, digits only, for `tel:` links. */
  phoneHref: string;
  email: string;
  hours: string;
};

/** "020 4634 2203" → "tel:+442046342203" */
export function toTelHref(phone: string): string {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return `tel:${digits}`;
  // UK numbers are stored in national format; drop the leading 0 for E.164.
  if (digits.startsWith("0")) return `tel:+44${digits.slice(1)}`;
  return `tel:${digits}`;
}

async function loadSupportContact(): Promise<SupportContact> {
  try {
    const connectDB = (await import("@/lib/mongodb")).default;
    const { Settings } = await import("@/models/Settings");
    await connectDB();
    const doc: any = await Settings.findOne().lean();

    const phone = String(doc?.supportPhone || "").trim() || DEFAULT_SUPPORT_PHONE;
    const email =
      String(doc?.supportEmail || "").trim() ||
      String(doc?.notificationEmail || "").trim() ||
      DEFAULT_SUPPORT_EMAIL;
    const hours = String(doc?.supportHours || "").trim() || DEFAULT_SUPPORT_HOURS;

    return { phone, phoneHref: toTelHref(phone), email, hours };
  } catch {
    return {
      phone: DEFAULT_SUPPORT_PHONE,
      phoneHref: toTelHref(DEFAULT_SUPPORT_PHONE),
      email: DEFAULT_SUPPORT_EMAIL,
      hours: DEFAULT_SUPPORT_HOURS,
    };
  }
}

/**
 * Cached for an hour — these details appear on every page and change rarely.
 * Tagged "settings" so an admin save can clear it.
 */
export const getSupportContact = unstable_cache(
  loadSupportContact,
  ["support-contact-v1"],
  { revalidate: 3600, tags: ["settings", "navigation"] },
);

/** Topics the support team handles — used by the Help Centre and chat intro. */
export const SUPPORT_TOPICS = [
  "Product specifications",
  "Measurements and quantities",
  "Delivery times",
  "Samples",
  "Stock availability",
  "Orders",
  "Returns and refunds",
  "Trade accounts",
  "Technical product advice",
] as const;
