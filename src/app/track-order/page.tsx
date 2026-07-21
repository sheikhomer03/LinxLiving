import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { TrackOrderForm } from "@/components/orders/TrackOrderForm";

export const metadata: Metadata = {
  title: "Track Order | Linx Square",
  description:
    "Track your Linx Square order status using your order ID from the confirmation email.",
  alternates: {
    canonical: "/track-order",
  },
};

export default function TrackOrderPage() {
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <TrackOrderForm />
      <Footer />
    </main>
  );
}
