import { getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";
import { getStoreName } from "@/app/actions/settings";

/**
 * Same seed the /category route passes into Navbar — brand + department
 * trees (cached ~5 min) plus store name. Use on every storefront page so
 * soft-nav never remounts an empty mega-menu.
 */
export async function getStorefrontNavProps() {
  const [brandRes, deptRes, storeName] = await Promise.all([
    getBrandMenuTrees(),
    getDepartmentTrees(),
    getStoreName(),
  ]);

  return {
    initialBrandMenus: brandRes.brands || [],
    initialDepartments: deptRes.departments || [],
    initialStoreName: storeName,
  };
}

export type StorefrontNavProps = Awaited<
  ReturnType<typeof getStorefrontNavProps>
>;
