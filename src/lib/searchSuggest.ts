/** The search box's results for a typed term, from /api/search/suggest. */
export async function fetchSearchSuggestions(term: string, limit: number) {
  const params = new URLSearchParams({ q: term, limit: String(limit) });
  const res = await fetch(`/api/search/suggest?${params}`);
  if (!res.ok) throw new Error("Search failed");
  const { products } = await res.json();
  return { products };
}
