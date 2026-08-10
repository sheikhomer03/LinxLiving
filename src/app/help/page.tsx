import Link from "next/link";
import type { Metadata } from "next";
import {
  MessageCircle,
  Phone,
  Mail,
  Truck,
  RotateCcw,
  PackageSearch,
  Package,
  Ruler,
  Wrench,
  ShieldCheck,
  Briefcase,
  HelpCircle,
  Lightbulb,
  Send,
} from "lucide-react";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { Footer } from "@/components/layout/Footer";
import { getSupportContact } from "@/lib/support";
import { HelpContactButtons } from "@/app/help/HelpContactButtons";

export const metadata: Metadata = {
  title: "Help & Support | Linx Square",
  description:
    "Get help with orders, delivery, returns, samples, measuring and product advice. Chat, call or email the Linx Square support team.",
  alternates: { canonical: "/help" },
};

/**
 * Help Centre — one page that gathers every support route.
 *
 * The topics that already have their own page link straight to it rather than
 * duplicating the content; the rest are answered inline. Purely additive: no
 * existing page or flow is altered.
 */
const TOPICS = [
  {
    icon: Send,
    title: "Contact us",
    body: "Send us a message and a member of the team will come back to you by email.",
    href: "/contact",
    cta: "Contact form",
  },
  {
    icon: Truck,
    title: "Delivery information",
    body: "UK delivery is a £50 flat rate, with most ranges arriving within 20 business days.",
    href: "/shipping-returns",
    cta: "Delivery details",
  },
  {
    icon: RotateCcw,
    title: "Returns & refunds",
    body: "How to return an item and what to expect once it reaches us.",
    href: "/shipping-returns",
    cta: "Returns policy",
  },
  {
    icon: PackageSearch,
    title: "Track your order",
    body: "Check where your order is using your order number and email address.",
    href: "/track-order",
    cta: "Track order",
  },
  {
    icon: Package,
    title: "Samples",
    body: "Order a free sample from any product page. It is a request, not a purchase — no payment is taken.",
    href: "/category",
    cta: "Browse ranges",
  },
  {
    icon: Ruler,
    title: "Measuring guides",
    body: "Tiles and flooring are sold by the m². Every product page has a calculator: enter your area, add 10% for wastage, and it rounds up to whole packs.",
    href: "/category?department=tiles",
    cta: "Shop tiles",
  },
  {
    icon: Lightbulb,
    title: "Product advice",
    body: "Not sure which range suits your project? Tell us the room, the traffic and the finish you want and the team will recommend options.",
    href: "/contact",
    cta: "Ask for advice",
  },
  {
    icon: Wrench,
    title: "Installation information",
    body: "Fitting guidance and installation accessories for each range.",
    href: "/category?department=accessories",
    cta: "Installation products",
  },
  {
    icon: ShieldCheck,
    title: "Warranty information",
    body: "Manufacturer warranties vary by brand and are listed on the product page under specifications.",
    href: "/category",
    cta: "View products",
  },
  {
    icon: Briefcase,
    title: "Trade accounts",
    body: "Trade pricing across every range. Apply through the contact form and the team will set you up.",
    href: "/contact",
    cta: "Apply for trade",
  },
  {
    icon: HelpCircle,
    title: "FAQs",
    body: "Answers to the questions we are asked most often.",
    href: "/faq",
    cta: "Read FAQs",
  },
] as const;

export default async function HelpPage() {
  const support = await getSupportContact();

  return (
    <main className="min-h-screen bg-white">
      <StorefrontNavbar />

      <section className="page-top pb-12 px-5 lg:px-10 border-b border-foreground/8">
        <div className="max-w-[1100px] mx-auto text-center">
          <p className="text-[11px] uppercase tracking-[0.3em] font-bold text-primary">
            Help &amp; Support
          </p>
          <h1 className="mt-4 font-serif normal-case text-3xl md:text-[3rem] leading-[1.1]">
            How can we help?
          </h1>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Speak to our sales and technical support team about specification,
            quantities, delivery or an existing order.
          </p>

          <HelpContactButtons
            phone={support.phone}
            phoneHref={support.phoneHref}
            email={support.email}
            hours={support.hours}
          />
        </div>
      </section>

      <section className="px-5 lg:px-10 py-14">
        <div className="max-w-[1100px] mx-auto">
          <h2 className="font-serif normal-case text-2xl md:text-3xl mb-8">
            Browse help topics
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {TOPICS.map(({ icon: Icon, title, body, href, cta }) => (
              <div
                key={title}
                className="border border-foreground/10 p-6 flex flex-col hover:border-foreground/25 transition-colors"
              >
                <Icon className="w-6 h-6 text-primary" strokeWidth={1.5} />
                <h3 className="mt-4 text-[15px] font-bold">{title}</h3>
                <p className="mt-2 flex-1 text-[13px] text-muted-foreground leading-relaxed">
                  {body}
                </p>
                <Link
                  href={href}
                  className="mt-4 text-[11px] uppercase tracking-[0.16em] font-bold underline underline-offset-4 hover:text-primary"
                >
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f6f1e9] px-5 lg:px-10 py-14">
        <div className="max-w-[1100px] mx-auto text-center">
          <h2 className="font-serif normal-case text-2xl md:text-3xl">
            Still need a hand?
          </h2>
          <p className="mt-3 text-muted-foreground">
            A member of the team is always available
            {support.hours ? ` — ${support.hours}` : ""}.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href={support.phoneHref || undefined}
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-foreground text-background text-[12px] font-bold uppercase tracking-[0.16em] hover:bg-foreground/85 transition-colors"
            >
              <Phone className="w-4 h-4" />
              {support.phone}
            </a>
            <a
              href={`mailto:${support.email}`}
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-foreground/25 text-[12px] font-bold uppercase tracking-[0.16em] hover:bg-white transition-colors"
            >
              <Mail className="w-4 h-4" />
              {support.email}
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-foreground/25 text-[12px] font-bold uppercase tracking-[0.16em] hover:bg-white transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Send a message
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
