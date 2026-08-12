import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getStoreName } from "@/app/actions/settings";
import { TRADE_DISCOUNT_PERCENT } from "@/lib/trade";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trade Account | Coming soon",
  description:
    "Trade accounts at LINX Square are opening soon — trade prices on every range.",
  alternates: { canonical: "/trade" },
};

/**
 * Trade accounts are not open to applications yet, so this page is a holding
 * state. The pricing engine behind it is already live: any user flagged
 * `isTradeAccount` gets TRADE_DISCOUNT_PERCENT off at checkout today, so the
 * launch is a content change rather than a build.
 */
export default async function TradeAccountPage() {
  const storeName = await getStoreName();

  const benefits = [
    `${TRADE_DISCOUNT_PERCENT}% off every order, applied automatically at checkout`,
    "One account covering every department and brand we stock",
    "Priced for the job — larger specifications save more",
    "Specification support, schedule pricing and samples",
  ];

  return (
    <main className="min-h-screen">
      <StorefrontNavbar />
      <PageHeader
        title="Trade Account"
        description="Trade prices on every range — opening soon."
        breadcrumb={[{ label: "Trade account", href: "/trade" }]}
      />

      <section className="py-24 px-6 lg:px-20 max-w-3xl mx-auto">
        <div className="text-center space-y-6">
          <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-primary">
            Coming soon
          </p>
          <h2 className="font-serif text-3xl md:text-[2.6rem] leading-[1.15] tracking-[-0.01em]">
            Trade accounts are on their way
          </h2>
          <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
            We are getting trade accounts ready. When they open, approved trade
            customers will pay {TRADE_DISCOUNT_PERCENT}% less than the listed
            price on everything we sell — no codes, applied automatically at
            checkout.
          </p>
        </div>

        <ul className="mt-14 border-t border-foreground/10">
          {benefits.map((benefit) => (
            <li
              key={benefit}
              className="flex gap-4 items-baseline border-b border-foreground/10 py-5"
            >
              <span className="text-primary text-[11px] font-bold tracking-[0.2em]">
                —
              </span>
              <span className="text-foreground/80 leading-relaxed">
                {benefit}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-14 bg-secondary/30 p-8 sm:p-12 border border-foreground/5 text-center space-y-6 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-[0.4em] text-primary">
            Want to be first in line?
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground max-w-lg mx-auto">
            Tell us about your business and we will get in touch as soon as
            trade accounts open. In the meantime our team can price a full
            schedule for you directly.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/contact?subject=Trade%20account%20enquiry"
              className="bg-primary text-primary-foreground px-10 py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-black hover:text-white transition-all shadow-xl shadow-primary/10"
            >
              Register your interest
            </Link>
            <Link
              href="/category"
              className="border border-foreground/15 px-10 py-5 uppercase tracking-widest text-[10px] font-bold hover:border-primary hover:text-primary transition-colors"
            >
              Browse the catalogue
            </Link>
          </div>
        </div>

        <p className="mt-10 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {storeName} — trade &amp; retail supply nationwide
        </p>
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}
