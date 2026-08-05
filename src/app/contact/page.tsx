import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  Clock,
  Mail,
  MapPin,
  Phone,
  MessageSquare,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { BrandLogo } from "@/components/layout/BrandLogo";
import {
  ContactForm,
  type ContactFormDefaults,
} from "@/components/contact/ContactForm";
import { getStoreName } from "@/app/actions/settings";

export const metadata: Metadata = {
  title: "Contact Us | Linx Square",
  description:
    "Speak with our specialist team about materials, samples, or your next architectural project.",
  alternates: {
    canonical: "/contact",
  },
};

const CHANNELS = [
  {
    icon: Phone,
    label: "Call",
    value: "020 4634 2203",
    href: "tel:02046342203",
    detail: "Speak with our team",
  },
  {
    icon: Mail,
    label: "Email",
    value: "info@linxsquare.co.uk",
    href: "mailto:info@linxsquare.co.uk",
    detail: "We reply within one business day",
  },
  {
    icon: MapPin,
    label: "Showroom",
    value: "189 Brampton Road",
    href: "https://maps.google.com/?q=189+Brampton+Road",
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
      <Navbar />

      <section className="relative overflow-hidden bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 right-[-10%] h-[32rem] w-[32rem] rounded-full bg-primary/18 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-12%] left-[-8%] h-[26rem] w-[26rem] rounded-full bg-white/[0.04] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />

        <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-20 pt-28 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28">
          <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-bold text-white/40 mb-12 md:mb-16">
            <Link href="/" className="hover:text-primary transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">Contact</span>
          </nav>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-14 lg:gap-16 xl:gap-20 items-start">
            <div className="lg:col-span-5 space-y-10 lg:sticky lg:top-36">
              <div className="space-y-5">
                <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-primary">
                  Client service
                </p>
                <BrandLogo
                  name={storeName}
                  variant="light"
                  size="md"
                  className="text-white/90"
                />
                <h1 className="font-serif text-4xl md:text-5xl xl:text-6xl tracking-[0.08em] uppercase text-white leading-tight">
                  Contact
                </h1>
                <p className="text-white/55 text-sm md:text-base leading-relaxed max-w-md">
                  {isSamplePrefill
                    ? "Your sample request details are ready below — add your contact info and send."
                    : "Tell us about your project — materials, samples, or a consultation. Our specialists will respond promptly."}
                </p>
              </div>

              <div className="space-y-0 border-t border-white/10">
                {CHANNELS.map((channel, i) => {
                  const Icon = channel.icon;
                  const inner = (
                    <>
                      <div className="flex items-center justify-center w-10 h-10 border border-white/15 text-primary shrink-0 group-hover:border-primary/50 transition-colors">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="space-y-1 pt-0.5 min-w-0">
                        <div className="flex items-baseline gap-3">
                          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/30">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <p className="font-serif text-lg tracking-[0.08em] uppercase text-white">
                            {channel.label}
                          </p>
                        </div>
                        <p className="text-sm text-white/80 tracking-wide truncate">
                          {channel.value}
                        </p>
                        <p className="text-xs text-white/40 tracking-wide">
                          {channel.detail}
                        </p>
                      </div>
                    </>
                  );

                  return channel.href.startsWith("http") ||
                    channel.href.startsWith("tel") ||
                    channel.href.startsWith("mailto") ? (
                    <a
                      key={channel.label}
                      href={channel.href}
                      target={
                        channel.href.startsWith("http") ? "_blank" : undefined
                      }
                      rel={
                        channel.href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="group flex gap-5 py-5 border-b border-white/10 hover:bg-white/[0.02] -mx-2 px-2 transition-colors"
                    >
                      {inner}
                    </a>
                  ) : (
                    <div
                      key={channel.label}
                      className="flex gap-5 py-5 border-b border-white/10"
                    >
                      {inner}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-start gap-3 text-white/40">
                <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Enquiries are usually answered within one business day,
                  Monday–Friday.
                </p>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="relative bg-white text-foreground p-5 sm:p-8 md:p-12 lg:p-14 space-y-6 sm:space-y-8 shadow-2xl shadow-black/30">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="w-5 h-5 text-primary" />
                    <p className="text-[10px] uppercase tracking-[0.35em] font-bold text-primary">
                      Send a message
                    </p>
                  </div>
                  <h2 className="font-serif text-2xl md:text-3xl tracking-[0.08em] uppercase">
                    {isSamplePrefill ? "Sample request" : "Project inquiry"}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {isSamplePrefill
                      ? "Subject and message are filled from the product you selected. Complete your details and send."
                      : "Share a few details and we will get back to you with next steps."}
                  </p>
                </div>

                <ContactForm defaults={defaults} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
