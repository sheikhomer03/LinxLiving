/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { createContext, useContext } from "react";

/**
 * The department tree, handed to the catalogue once.
 *
 * The catalogue layout renders the navbar and the page renders the grid, and
 * both need the tree. Passed to each as a prop it was serialised twice —
 * ~140 KB each time — because React writes a client component's props per
 * element. A provider in the layout carries it once and both read it here.
 */
const CatalogueDepartmentsContext = createContext<any[] | null>(null);

export function CatalogueDepartmentsProvider({
  departments,
  children,
}: {
  departments: any[];
  children: React.ReactNode;
}) {
  return (
    <CatalogueDepartmentsContext.Provider value={departments}>
      {children}
    </CatalogueDepartmentsContext.Provider>
  );
}

/** The layout's department tree, or null outside the catalogue layout. */
export function useCatalogueDepartments(): any[] | null {
  return useContext(CatalogueDepartmentsContext);
}
