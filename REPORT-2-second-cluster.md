# Report 2 — Keep the current architecture, add a second MongoDB cluster

**Question:** leave everything as it is and add a second Atlas cluster (a free M0 in a new project) to hold the Drench catalogue, reading and writing it there while the rest stays put. Same Shopify store throughout.

**Verdict up front:** possible, cheap, and quick to wire up — but it buys storage at the cost of losing cross-brand queries. It works well *only* if Drench stays self-contained.

---

## Current numbers

| | |
|---|---|
| Logical data | 318.98 MB |
| Storage on disk (compressed) | 123.86 MB |
| Indexes | 83.79 MB |
| **Billed disk usage** | **207.65 MB** |
| Products | 27,594 (5,546 of them Drench) |
| Largest brand | Pooky — 156 MB logical, 43 KB/product |

If the cluster is M0 (512 MB), you are at ~41%. Drench added roughly 60–70 MB of that.

---

## Pros

### 1. Very little code changes

Mongoose supports multiple connections natively:

```js
const clusterB = mongoose.createConnection(process.env.MONGODB_URI_B);
const ProductB = clusterB.model("Product", ProductSchema);
```

Route by brand at the query layer. The 191-field schema, the trade logic, VAT, delivery zones, the configurator, the mega-menu — all untouched.

### 2. Free

Atlas allows one M0 per **project**, not per account. A second project gives you another 512 MB at £0. Total 1 GB.

### 3. Fully reversible

Data can be moved back with a dump/restore. Nothing about the storefront is rewritten, so abandoning the approach costs almost nothing. Contrast with Report 1, which is a one-way door.

### 4. Everything Linx-specific keeps working

Trade accounts, configured/made-to-measure pricing, calculators, facets, the menu tree — none of it is affected, because none of it changes.

### 5. Blast radius is contained

A problem on cluster B affects Drench only. Your other 27 brands keep running on cluster A.

### 6. Shopify is unaffected

Shopify is a separate API. It neither knows nor cares how many databases you use. One store, one set of credentials, no conflict.

---

## Cons

### 1. No cross-cluster queries — the central limitation

MongoDB cannot `$lookup`, join, or run a single query spanning two clusters. Anything that mixes Drench with other brands has to query both and merge in application code.

**And merged results cannot be sorted or paginated correctly.** Neither cluster can sort against rows it cannot see. "Page 3 of Bathrooms sorted by price ascending" has no correct answer when half the rows live in another cluster.

Affected surfaces:

| Surface | Code | Impact |
|---|---|---|
| Category / department listings | `getPublicProducts` (`products.ts:306`) | sort + pagination break on mixed pages |
| Facet counts | `computeCatalogFacetCounts` (`products.ts:1368`) | counts cannot span clusters |
| Search | listing query path | must query both, merge, re-rank |
| Related / recommendation rails | `getRelatedListing`, `getCartRecommendations` | two queries instead of one |

### 2. Drench must stay self-contained

The workable shape is Drench having **its own brand pages**, excluded from mixed listings, search and facets — the way `HIDDEN_BRAND_SLUGS` already excludes Britmet from the storefront.

That is a real product decision, not just a technical one: those 5,546 products would not appear when a customer browses "Bathrooms" or searches "basin tap".

### 3. No transactions across clusters

An order referencing products in both clusters cannot be written atomically. Your checkout resolves every line against Mongo (`src/app/api/checkout/shopify/route.ts`) — it would need to know which cluster to ask, and stock decrements across clusters cannot be made consistent.

### 4. M0 is not a production tier

- **No automated backups.** This is the significant one. A free cluster has no point-in-time recovery. Your capture file is the only copy if cluster B is lost.
- Shared CPU and RAM, variable performance under load
- 500 connection cap — and serverless (Vercel) opens pools per instance; two pools doubles the pressure
- No performance advisor, limited metrics

### 5. Operational overhead doubles

Two connection strings, two sets of credentials, two things to monitor, two failure modes, two backup stories. Every new developer has to learn which data lives where.

### 6. It postpones the problem rather than solving it

512 MB more buys time, not a strategy. At current growth — Pooky alone is 156 MB — you will be having this conversation again. Splitting a third time is worse than the second.

### 7. Connection cost on serverless

Each cold start now establishes two connections instead of one, adding latency to the first request and consuming more of both clusters' connection budgets.

---

## The alternative worth weighing

| Option | Cost | Effort | Backups | Cross-brand queries |
|---|---|---|---|---|
| Second free M0 | £0 | ~1 day | ❌ none on M0 | ❌ broken |
| Atlas Flex | ~£8–25/mo | none | ✅ | ✅ intact |
| Atlas M10 | ~£45/mo | none | ✅ | ✅ intact |
| Trim Pooky to an index stub | £0 | ~1 day | n/a | ✅ intact |

Pooky is **156 MB of your 284 MB** at 43 KB per product. Trimming that one brand frees more space than a second free cluster would, without splitting anything.

---

## Recommendation

**A second free cluster is the wrong tool if the goal is simply headroom.** It trades a £0 saving for broken cross-brand listings, no backups on the new cluster, and permanent operational complexity.

In order of preference:

1. **Upgrade the tier.** Flex or M10. Costs less per month than an hour of engineering, keeps every query working, and gives you backups. This is almost certainly the right answer.
2. **Trim the heavy brands to index stubs.** Pooky first — it alone would free ~100 MB. Free, and the catalogue stays whole.
3. **Second cluster** only if Drench is genuinely going to live as a separate, self-contained storefront section that never appears in mixed listings or search.

The one thing not to do is take option 3 while still expecting Drench products to show up alongside your other brands — that combination cannot be made to work correctly.
