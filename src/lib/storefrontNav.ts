import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";

/**
 * Same seed the /category route passes into Navbar — the department tree
 * (cached ~5 min) plus the store name. Use on every storefront page.
 *
 * The brand tree is deliberately not here any more. It used to be, and since
 * roughly twenty routes render <StorefrontNavbar />, that put 458 KB of menu
 * JSON into each of their documents — for mega panels that are gated on
 * `activeTab` and so are not in the DOM until a tab is hovered. The navbar
 * now pulls it from /api/navigation, a GET the browser caches for five
 * minutes and shares across every page after the first.
 *
 * Departments stay: their top-level links are the visible nav row, painted
 * immediately, so they have to be in the HTML.
 */
export async function getStorefrontNavProps() {
  const [deptRes, storeName] = await Promise.all([
    getDepartmentTrees(),
    getStoreName(),
  ]);

  return {
    initialDepartments: deptRes.departments || [],
    initialStoreName: storeName,
  };
}

export type StorefrontNavProps = Awaited<
  ReturnType<typeof getStorefrontNavProps>
>;
