import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";

/*
 * Rendered per request, as before. The root layout no longer reads the
 * session (so storefront pages can be cached), which would otherwise let Next
 * cache this route too — and there is nothing to gain from caching a page
 * that is personal or part of an order.
 */
export const dynamic = "force-dynamic";

/**
 * Seed department/brand menus like /category so soft-nav into the
 * reset flow does not remount an empty Navbar.
 */
export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <StorefrontNavbar />
      {children}
    </>
  );
}
