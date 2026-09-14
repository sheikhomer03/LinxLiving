"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import type { ComponentProps } from "react";

type NavbarProps = Omit<ComponentProps<typeof Navbar>, "overlay">;

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
  // Read so the component is bound to param changes and re-renders with the
  // page it is sitting on, even though the decision is pathname-only today.
  useSearchParams();

  return <Navbar {...props} overlay={pathname.startsWith("/category")} />;
}
