import CategoryTemplate from "@/components/layout/CategoryTemplate";
import { Suspense } from "react";
import type { Metadata } from "next";
import { buildListingQuery } from "@/lib/listingQuery";
import { getPublicProducts } from "@/app/actions/products";
import { getStoreName } from "@/app/actions/settings";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; search?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const query = params.search || params.q;
  return {
    title: query ? `Search results for "${query}"` : "Search Our Catalog",
    description: query
      ? `Explore our collection of luxury architectural materials matching "${query}".`
      : "Discover exquisite stone baths, fine ceramics, and luxury architectural tiles.",
    robots: {
      index: false,
      follow: true,
    },
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Departments whose listings the browser filters further (dropPlaceholderImages). */
const CLIENT_FILTERED_DEPARTMENTS = new Set(["outdoor-living", "accessories"]);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The store name comes with the page, as on the other storefront pages,
  // rather than each navbar asking the server for it after it mounts.
  const [sp, storeName] = await Promise.all([searchParams, getStoreName()]);
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const query = first(sp.search) || first(sp.q) || "";

  const common = {
    title: query ? `Results for "${query}"` : "Search Results",
    description: query
      ? `Discover our exquisite collection matching your inquiry for "${query}".`
      : "Explore our full catalog of luxury architectural elements.",
    slug: "all",
    browseAll: true,
    initialStoreName: storeName,
  };

  /*
   * The first page of results is read here, on the server.
   *
   * The page used to arrive with an empty grid: nothing could ask for results
   * until the browser had downloaded and started the page's scripts, and the
   * search itself then had to run — so the first photograph appeared seconds
   * after the page did. Reading it here puts the results in the same response.
   *
   * Same query the browser builds for this URL (lib/listingQuery), run live
   * as the browser's was — search results are not cached. The grid renders
   * immediately in its usual loading state and the results stream into it.
   *
   * Left to the browser, as before, when the menu tree is needed to read the
   * URL or the department's listing is filtered further in the browser.
   */
  const searchKey = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null
        ? []
        : Array.isArray(v)
          ? v.map((x) => [k, x] as [string, string])
          : [[k, v] as [string, string]],
    ),
  ).toString();
  const { query: listingQuery, needsMenuRemap } = buildListingQuery({
    searchKey,
    slug: "all",
    browseAll: true,
  });
  const serverRenders =
    !needsMenuRemap &&
    !(listingQuery.department || []).some((d) =>
      CLIENT_FILTERED_DEPARTMENTS.has(d),
    );

  if (!serverRenders) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Scouring catalog...
            </div>
          </div>
        }
      >
        <CategoryTemplate {...common} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<CategoryTemplate {...common} initialProductsPending />}>
      <SearchResults
        common={common}
        listingQuery={listingQuery}
        searchKey={searchKey}
      />
    </Suspense>
  );
}

async function SearchResults({
  common,
  listingQuery,
  searchKey,
}: {
  common: React.ComponentProps<typeof CategoryTemplate>;
  listingQuery: Parameters<typeof getPublicProducts>[0];
  searchKey: string;
}) {
  const initialProducts = await getPublicProducts(listingQuery);
  return (
    <CategoryTemplate
      {...common}
      initialProducts={initialProducts}
      initialProductsKey={searchKey}
    />
  );
}
