import type { Metadata } from "next";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { PageBanner } from "@/components/layout/PageBanner";
import { Footer } from "@/components/layout/Footer";
import { TrackOrderForm } from "@/components/orders/TrackOrderForm";
import { getStoreName } from "@/app/actions/settings";

export const metadata: Metadata = {
  title: "Track Order | Linx Square",
  description:
    "Track your Linx Square order status using your order ID from the confirmation email.",
  alternates: {
    canonical: "/track-order",
  },
};

const BANNER_IMAGE = "/home/hero/wood-flooring.png";

export default async function TrackOrderPage() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen bg-background">
      <StorefrontNavbar overlay />

      {/* `standard`, as on /faq: the lookup field is the point of the page and
          should not sit below a full screen of photography. The banner is the
          page's own — the form below it now renders only the body, in either
          the search or the result state. */}
      <PageBanner image={BANNER_IMAGE} title="Track Order" size="standard" />

      <TrackOrderForm />

      <Footer initialStoreName={storeName} />
    </main>
  );
}
