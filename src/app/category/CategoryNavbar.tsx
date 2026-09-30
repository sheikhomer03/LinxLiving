"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import type { ComponentProps } from "react";
import { useCatalogueDepartments } from "./CatalogueDepartments";

type NavbarProps = Omit<
  ComponentProps<typeof Navbar>,
  "overlay" | "activeDepartmentParam" | "saleParamActive" | "initialDepartments"
>;

/**
 * The catalogue navbar, transparent over whatever dark block opens the page.
 *
 * Both pages under `/category` now lead with one: the index with its
 * full-bleed photographic banner, the listing with the black hero. On the
 * reference the header sits on top of each of them in white ink rather than
 * above them, so it overlays for the whole route.
 *
 * It still has to be decided in a client component rather than in the page,
 * because the navbar is rendered by `layout.tsx` — deliberately, so it sits
 * outside the `loading.tsx` boundary and a department click repaints only
 * the grid — and a layout is not given the route's params.
 */
export function CategoryNavbar(props: NavbarProps) {
  const pathname = usePathname();
  const overlay = pathname.startsWith("/category");
  const initialDepartments = useCatalogueDepartments() ?? undefined;

  // Only the listing reads its query string: that is where the navbar
  // highlights the department (or Sale) being browsed. `/category/[slug]`
  // never did, so it renders without touching the search params at all.
  if (pathname === "/category") {
    return (
      <ListingNavbar
        {...props}
        initialDepartments={initialDepartments}
        overlay={overlay}
      />
    );
  }
  return (
    <Navbar {...props} initialDepartments={initialDepartments} overlay={overlay} />
  );
}

function ListingNavbar(
  props: NavbarProps & {
    overlay: boolean;
    initialDepartments: ComponentProps<typeof Navbar>["initialDepartments"];
  },
) {
  const searchParams = useSearchParams();
  return (
    <Navbar
      {...props}
      activeDepartmentParam={searchParams.get("department")}
      saleParamActive={searchParams.get("onSale") === "1"}
    />
  );
}
