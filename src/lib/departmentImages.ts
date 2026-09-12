import { sanitizeDisplayImageUrl } from "@/lib/productImage";

/**
 * The photograph a department's mega-menu panel shows.
 *
 * Lusso Stone closes every dropdown with one image card pinned to the right
 * of the link columns — a 16:9 product or room shot with "SHOP ALL {DEPT}"
 * beneath it, and no caption. This is where ours gets its picture.
 *
 * `Department.image` is the real source: an admin upload that already exists
 * on the department record (see the imageUrl/image handling in
 * app/actions/departments.ts). It is currently empty on all twenty
 * departments, so nothing would render until someone uploads through the
 * admin — which is why the four staged interiors already in /public stand in
 * meanwhile. They are the same shots the homepage uses for its feature bands.
 *
 * Failing both, `coverImage` is a photograph picked out of the department's
 * own stock by getDepartmentTrees — a lifestyle shot where one exists, a
 * product shot otherwise, always the Shopify copy. That is what gives the
 * other sixteen departments a picture.
 *
 * Order is deliberate: a real upload beats a hand-picked interior, and a
 * hand-picked interior beats whatever the catalogue happens to lead with.
 *
 * To retire the interim map, upload a photograph against each department in
 * the admin; `image` wins over anything listed here.
 */
const INTERIM_DEPARTMENT_SHOTS: Record<string, string> = {
  flooring: "/home/hero/wood-flooring.png",
  tiles: "/home/hero/kitchen-tiles.png",
  bathrooms: "/home/hero/bathroom-tiles.png",
  heating: "/home/hero/heating-flooring.png",
};

export function departmentMenuImage(
  dept:
    | { slug?: string; image?: string; coverImage?: string }
    | null
    | undefined,
): string {
  const own = sanitizeDisplayImageUrl(dept?.image || "");
  if (own) return own;
  const interim =
    INTERIM_DEPARTMENT_SHOTS[String(dept?.slug || "").toLowerCase()];
  if (interim) return interim;
  return sanitizeDisplayImageUrl(dept?.coverImage || "");
}
