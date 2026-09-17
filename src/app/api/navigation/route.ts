import { NextResponse } from "next/server";
import { getBrandMenuTrees } from "@/app/actions/admin";
import { getDepartmentTrees } from "@/app/actions/departments";

/**
 * The navbar's brand tree, served once and cached by the browser.
 *
 * It used to travel as an RSC prop: `initialBrandMenus` on every page that
 * renders <Navbar />. That tree is 1,381 menu nodes — 458 KB of JSON — and
 * React serialises it once per element, so a product page shipped it twice
 * (916 KB of a 1.23 MB payload) and a category page three times (1.37 MB of
 * 1.72 MB). Nine tenths of every HTML response was a menu.
 *
 * None of it is on screen at first paint: the mega panels are gated on
 * `activeTab`, which starts null, so the markup does not exist until someone
 * hovers a tab. Paying for it in the document was buying nothing.
 *
 * Here it is one GET the browser can cache, fetched once per session and
 * shared by every page after — see navCache for the sessionStorage layer in
 * front of it. Same data, same tree, same menu; it just stops riding along
 * with the product.
 *
 * Departments come too so the pair stays consistent, though those still ship
 * as props: the top-level department links ARE painted immediately.
 */
export async function GET() {
  const [brandRes, deptRes] = await Promise.all([
    getBrandMenuTrees(),
    getDepartmentTrees(),
  ]);

  return NextResponse.json(
    {
      brands: brandRes.brands || [],
      departments: deptRes.departments || [],
    },
    {
      headers: {
        /*
         * Both reads are `unstable_cache` with `revalidate: 300` behind the
         * "navigation" tag, so five minutes is what the server already holds.
         * `stale-while-revalidate` lets a returning visitor paint the menu
         * from cache while the refresh runs.
         */
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
