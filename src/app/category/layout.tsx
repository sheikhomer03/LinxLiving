import { Suspense } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { CategoryNavbar } from "./CategoryNavbar";
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
 * the grid. Both reads are `unstable_cache` hits (a few milliseconds) and are
 * shared with the page below via React's request cache, so hoisting them
 * costs nothing.
 */
export default async function CategoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [deptRes, storeName] = await Promise.all([
    getDepartmentTrees(),
    getStoreName(),
  ]);

  /*
   * No `initialBrandMenus` here. The navbar fetches its brand tree from
   * /api/navigation instead, because this layout renders the navbar twice —
   * once as the Suspense fallback, once as the resolved CategoryNavbar — and
   * React serialises a client component's props per element. The tree is
   * 458 KB, so passing it down wrote it into the catalogue's HTML twice over,
   * for panels that are not in the DOM until a tab is hovered.
   */
  const navProps = {
    initialDepartments: deptRes.departments || [],
    initialStoreName: storeName,
  };

  return (
    <>
      {/*
        CategoryNavbar reads the search params to decide whether to render
        transparent over the index banner. That needs a Suspense boundary,
        and the fallback is the same navbar in its solid state rather than
        nothing — the whole point of hoisting it out of `loading.tsx` was
        that the header must never blank out.
      */}
      <Suspense fallback={<Navbar {...navProps} />}>
        <CategoryNavbar {...navProps} />
      </Suspense>
      {children}
    </>
  );
}
