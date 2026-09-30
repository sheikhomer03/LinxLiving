import { CategoryNavbar } from "./CategoryNavbar";
import { CatalogueDepartmentsProvider } from "./CatalogueDepartments";
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
   * /api/navigation instead: the tree is 458 KB, and passing it down wrote it
   * into the catalogue's HTML for panels that are not in the DOM until a tab
   * is hovered.
   */

  return (
    /*
      The department tree is serialised once, here, and read from context by
      both the navbar and the page's grid — as props it went into every
      catalogue page once per component that received it (~140 KB each).
    */
    <CatalogueDepartmentsProvider departments={deptRes.departments || []}>
      {/*
        Rendered once, with no Suspense fallback beside it. The fallback used
        to be a second copy of this navbar, never shown: the only search
        params read here are on `/category`, which is always rendered per
        request, where `useSearchParams` does not suspend.
      */}
      <CategoryNavbar initialStoreName={storeName} />
      {children}
    </CatalogueDepartmentsProvider>
  );
}
