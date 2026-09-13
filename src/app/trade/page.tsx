import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { PageBanner } from "@/components/layout/PageBanner";
import { Footer } from "@/components/layout/Footer";
import { TradeAccountForms } from "@/components/trade/TradeAccountForms";
import { getStoreName } from "@/app/actions/settings";
import { getTradeDepartmentOptions } from "@/app/actions/trade";
import { TRADE_DISCOUNT_PERCENT } from "@/lib/trade";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trade Account | Linx Square",
  description:
    "Apply for a Linx Square trade account and get trade pricing on the departments you buy from.",
  alternates: { canonical: "/trade" },
};

const BANNER_IMAGE = "/images/trade-account-hero.jpg";

const EYEBROW =
  "font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]";

export default async function TradeAccountPage() {
  const [storeName, deptRes] = await Promise.all([
    getStoreName(),
    getTradeDepartmentOptions(),
  ]);

  const benefits = [
    `${TRADE_DISCOUNT_PERCENT}% off, applied automatically at checkout — no codes`,
    "Choose the departments you buy from, or take the whole catalogue",
    "Trade pricing shown while you browse, not just at the basket",
    "Specification support, schedule pricing and free samples",
  ];

  return (
    <main className="min-h-screen bg-background">
      <StorefrontNavbar overlay />

      <PageBanner image={BANNER_IMAGE} title="Trade Account" />

      <section className="px-4 py-12 lg:px-8 lg:py-16">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5 self-start lg:sticky lg:top-32">
            <p className={EYEBROW}>Trade &amp; specification</p>
            <h2 className="mt-4 text-xl font-medium uppercase leading-tight text-foreground sm:text-2xl">
              Trade pricing on the ranges you buy
            </h2>
            <p className="mt-4 max-w-md text-[13px] leading-relaxed text-foreground/70 sm:text-sm">
              Apply for an account and, once our team has approved it, every
              price you see across your departments is {TRADE_DISCOUNT_PERCENT}%
              lower — while browsing, in the basket and at checkout.
            </p>

            <ul className="mt-10 border-t border-black/10">
              {benefits.map((benefit, i) => (
                <li
                  key={benefit}
                  className="flex gap-6 border-b border-black/10 py-5"
                >
                  <span className="font-menu shrink-0 pt-0.5 text-[9px] font-medium uppercase tracking-[1.4px] text-black/30 lg:text-[10px]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] leading-relaxed text-foreground/80">
                    {benefit}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-[11px] leading-relaxed text-foreground/50">
              Applications are reviewed by hand, usually within one business
              day. We will email you the moment your account is approved.
            </p>
          </div>

          <div className="lg:col-span-7">
            <div className="border border-black/10 p-5 sm:p-8 lg:p-10">
              <TradeAccountForms departments={deptRes.departments || []} />
            </div>
          </div>
        </div>
      </section>

      <Footer initialStoreName={storeName} />
    </main>
  );
}
