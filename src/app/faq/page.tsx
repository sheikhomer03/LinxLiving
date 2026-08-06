import FAQContent from "./FAQContent";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Frequently Asked Questions | Architectural Materials Guide",
  description:
    "Find answers regarding our luxury materials, global logistics, production lead times, and stone maintenance requirements.",
  alternates: {
    canonical: "/faq",
  },
};

export default function FAQPage() {
  return <FAQContent navbar={<StorefrontNavbar />} />;
}
