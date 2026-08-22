import { Navbar } from "@/components/layout/Navbar";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";

/**
 * The navigation lives above the catalogue's loading boundary.
 *
 * Clicking a navbar department used to blank the window: `loading.tsx` is the
 * fallback for everything below it, and with the navbar rendered by the page
 * that meant the header, the search and the menu all disappeared until the
 * products came back. The customer was left looking at an empty white page
 * with a spinner where the site had been.
 *
 * Rendering it here puts it outside that boundary, so a click repaints only
 * the grid. The three reads are all `unstable_cache` hits (a few milliseconds)
 * and are shared with the page below via React's request cache, so hoisting
 * them costs nothing.
 */
export default async function CategoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [brandRes, deptRes, storeName] = await Promise.all([
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  return (
    <>
      <Navbar
        initialBrandMenus={brandRes.brands || []}
        initialDepartments={deptRes.departments || []}
        initialStoreName={storeName}
      />
      {children}
    </>
  );
}
