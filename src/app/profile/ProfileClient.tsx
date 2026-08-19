"use client";
import { useState, useEffect, type ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import Link from "next/link";
import { User, Lock, MapPin, Package, Heart } from "lucide-react";
import { PersonalDetails } from "@/components/profile/PersonalDetails";
import { ChangePassword } from "@/components/profile/ChangePassword";
import { AddressBook } from "@/components/profile/AddressBook";
import { OrdersReturns } from "@/components/profile/OrdersReturns";
import { Wishlist } from "@/components/profile/Wishlist";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const TABS = [
  { id: "personal", label: "Personal Details", icon: User, component: PersonalDetails },
  { id: "password", label: "Change Password", icon: Lock, component: ChangePassword },
  { id: "addresses", label: "Address Book", icon: MapPin, component: AddressBook },
  { id: "orders", label: "Orders & Returns", icon: Package, component: OrdersReturns },
  { id: "wishlist", label: "Wishlist", icon: Heart, component: Wishlist },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ProfileClient({ navbar }: { navbar: ReactNode }) {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<TabId>("personal");
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <main className="min-h-screen flex flex-col">
        {navbar}
        <section className="flex-1 pt-32 md:pt-52 pb-24 px-6 lg:px-20 max-w-8xl mx-auto w-full">
          <div className="space-y-4">
            <div className="h-12 w-48 bg-foreground/5 animate-pulse rounded-sm" />
            <div className="border-b border-foreground/5 pb-4">
              <div className="h-4 w-full bg-foreground/5 animate-pulse rounded-sm" />
            </div>
            <div className="mt-12">
              <div className="space-y-4">
                <div className="h-8 w-64 bg-foreground/5 animate-pulse rounded-sm" />
                <div className="space-y-2">
                  <div className="h-12 w-full bg-foreground/5 animate-pulse rounded-sm" />
                  <div className="h-12 w-full bg-foreground/5 animate-pulse rounded-sm" />
                </div>
              </div>
            </div>
          </div>
        </section>
        <Footer />
      </main>
    );
  }

  if (!session) return null;

  const ActiveComponent =
    TABS.find((tab) => tab.id === activeTab)?.component || PersonalDetails;

  const activeLabel =
    TABS.find((tab) => tab.id === activeTab)?.label || "Personal Details";

  return (
    <main className="min-h-screen flex flex-col">
      {navbar}

      <section className="flex-1 pt-32 md:pt-52 pb-24 px-6 lg:px-20 max-w-8xl mx-auto w-full">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold mb-8 opacity-80">
          <Link href="/" className="hover:opacity-800">
            Home
          </Link>
          <span>/</span>
          <span className="text-primary italic">My {activeLabel}</span>
        </div>

        <div className="space-y-4">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-serif tracking-tight uppercase text-primary">
              Account
            </h1>
          </div>

          <div className="border-b border-foreground/5">
            {/* Below `lg` five labels don't fit on one line at their full
                width — flex-wrap orphaned the last tab onto its own row with
                an odd gap above it. Every tab instead shares the row equally,
                with a small icon standing in for the label until there's
                room to spell it out, so all five always stay on one row. */}
            <div className="flex gap-x-1 lg:gap-x-8 gap-y-4 lg:flex-wrap">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabId)}
                    className={cn(
                      "flex-1 min-w-0 lg:flex-none flex flex-col lg:flex-row items-center lg:items-center justify-center lg:justify-start gap-1 lg:gap-0 text-center lg:text-left text-[6.5px] sm:text-[10px] lg:text-[11px] uppercase tracking-[0.02em] sm:tracking-[0.14em] lg:tracking-[0.2em] font-bold transition-all duration-300 relative py-3 lg:py-4 px-0.5",
                      activeTab === tab.id
                        ? "text-primary after:absolute after:bottom-0 after:left-0 after:w-full after:h-px after:bg-primary"
                        : "text-muted-foreground hover:text-primary transition-colors",
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0 lg:hidden" />
                    <span className="leading-tight">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-12 bg-transparent">
            <ActiveComponent />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
