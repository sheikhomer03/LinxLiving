import AdminLayoutContent from "./AdminLayoutContent";
import type { Metadata } from "next";

/*
 * Rendered per request, as before. The root layout no longer reads the
 * session (so storefront pages can be cached), which would otherwise let Next
 * cache this route too — and there is nothing to gain from caching a page
 * that is personal or part of an order.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Dashboard | Linx Square",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutContent>{children}</AdminLayoutContent>;
}
