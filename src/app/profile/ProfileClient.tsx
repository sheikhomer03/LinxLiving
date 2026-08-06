"use client";
import { useState, useEffect, type ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import Link from "next/link";
import { PersonalDetails } from "@/components/profile/PersonalDetails";
import { ChangePassword } from "@/components/profile/ChangePassword";
import { AddressBook } from "@/components/profile/AddressBook";
import { OrdersReturns } from "@/components/profile/OrdersReturns";
import { Wishlist } from "@/components/profile/Wishlist";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const TABS = [
  { id: "personal", label: "Personal Details", component: PersonalDetails },
  { id: "password", label: "Change Password", component: ChangePassword },
  { id: "addresses", label: "Address Book", component: AddressBook },
  { id: "orders", label: "Orders & Returns", component: OrdersReturns },
  { id: "wishlist", label: "Wishlist", component: Wishlist },
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
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={cn(
                    "text-[10px] md:text-[11px] uppercase tracking-[0.2em] font-bold transition-all duration-300 relative py-4",
                    activeTab === tab.id
                      ? "text-primary after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1px] after:bg-primary"
                      : "text-muted-foreground hover:text-primary transition-colors",
                  )}
                >
                  {tab.label}
                </button>
              ))}
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
