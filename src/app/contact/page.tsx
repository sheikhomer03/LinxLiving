import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { PageBanner } from "@/components/layout/PageBanner";
import { Footer } from "@/components/layout/Footer";
import {
  ContactForm,
  type ContactFormDefaults,
} from "@/components/contact/ContactForm";
import { getStoreName } from "@/app/actions/settings";
import { COMPANY_ADDRESS_LINE, COMPANY_MAP_HREF } from "@/lib/company";

export const metadata: Metadata = {
  title: "Contact Us | Linx Square",
  description:
    "Speak with our specialist team about materials, samples, or your next architectural project.",
  alternates: {
    canonical: "/contact",
  },
};

/**
 * The photograph behind the banner.
 *
 * Deliberately not the catalogue index's still (`bathroom-tiles`): the two
 * pages open with the same block at the same height, so sharing the image
 * would make them read as the same page.
 */
const BANNER_IMAGE = "/home/hero/kitchen-tiles.png";

const CHANNELS = [
  {
    label: "Call",
    value: "020 4634 2203",
    href: "tel:02046342203",
    detail: "Speak with our team",
  },
  {
    label: "Email",
    value: "info@linxsquare.co.uk",
    href: "mailto:info@linxsquare.co.uk",
    detail: "We reply within one business day",
  },
  {
    label: "Showroom",
    value: COMPANY_ADDRESS_LINE,
    href: COMPANY_MAP_HREF,
    detail: "Visit by appointment",
  },
] as const;

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  const v = value?.trim();
  return v || undefined;
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [storeName, sp] = await Promise.all([getStoreName(), searchParams]);

  // Support both sample links (?intent=sample&productName=…) and quote
  // links from main (?product=&ref=&brand=).
  const defaults: ContactFormDefaults = {
    intent:
      firstParam(sp.intent) ||
      (firstParam(sp.product) ? "quote" : undefined),
    productId: firstParam(sp.productId) || firstParam(sp.ref),
    productName: firstParam(sp.productName) || firstParam(sp.product),
    sku: firstParam(sp.sku),
    brand: firstParam(sp.brand),
    category: firstParam(sp.category),
    price: firstParam(sp.price),
    topic: firstParam(sp.topic),
  };

  const isSamplePrefill = Boolean(
    defaults.intent === "sample" || defaults.productName,
  );

  return (
    <main className="min-h-screen bg-background">
      {/* `overlay` as on /category: the header runs transparent in white ink
          over the banner below rather than sitting above it. */}
      <StorefrontNavbar overlay />

      <PageBanner image={BANNER_IMAGE} title="Contact" />

      <section className="px-4 py-12 lg:px-8 lg:py-16">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          {/* The left column stays put while the form scrolls, as the old
              layout did — it is short enough that nothing is cut off. */}
          <div className="lg:col-span-5 self-start lg:sticky lg:top-32">
            <p className="font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]">
              Client service
            </p>
            <h2 className="mt-4 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
              Talk to a specialist
            </h2>
            <p className="mt-4 max-w-md text-[13px] leading-relaxed text-foreground/70 sm:text-sm">
              {isSamplePrefill
                ? "Your sample request details are ready beside this — add your contact information and send."
                : "Tell us about your project — materials, samples, or a consultation. Our specialists will respond promptly."}
            </p>

            <ul className="mt-10 border-t border-black/10">
              {CHANNELS.map((channel) => (
                <li key={channel.label}>
                  <a
                    href={channel.href}
                    target={
                      channel.href.startsWith("http") ? "_blank" : undefined
                    }
                    rel={
                      channel.href.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                    className="group flex items-start justify-between gap-6 border-b border-black/10 py-5 transition-colors hover:bg-black/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]">
                        {channel.label}
                      </p>
                      <p className="mt-2 text-[13px] leading-snug text-foreground sm:text-sm">
                        {channel.value}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/50">
                        {channel.detail}
                      </p>
                    </div>
                    <ArrowUpRight
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 stroke-[1.5] text-foreground/35 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                    />
                  </a>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-[11px] leading-relaxed text-foreground/50">
              Enquiries are usually answered within one business day,
              Monday–Friday.
            </p>
          </div>

          <div className="lg:col-span-7">
            {/* A hairline box on white, not the old white card floating on a
                dark ground — there is no dark ground on this page any more. */}
            <div className="border border-black/10 p-5 sm:p-8 lg:p-10">
              <p className="font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]">
                Send a message
              </p>
              <h2 className="mt-3 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
                {isSamplePrefill ? "Sample request" : "Project enquiry"}
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-foreground/70 sm:text-sm">
                {isSamplePrefill
                  ? "Subject and message are filled from the product you selected. Complete your details and send."
                  : "Share a few details and we will get back to you with next steps."}
              </p>

              <div className="mt-8">
                <ContactForm defaults={defaults} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}
