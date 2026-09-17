# Report 1 — Drop MongoDB, use Shopify as the only backend

**Question:** remove the database entirely and let Shopify be the single source of truth for the catalogue.

**Verdict up front:** technically possible, but this is a rewrite of the storefront, not a migration. The blockers are not about product data — they are about everything Linx does *around* a product that Shopify has no concept of.

---

## What Shopify would give you

| Benefit | Why it matters here |
|---|---|
| **One source of truth** | Today you dual-write Mongo → Shopify. That drift is real: the repo carries rollback files for echo-dedupe, orphan products and image parity repairs. All of that disappears. |
| **No storage ceiling** | Current cluster is at **207 MB** of a possibly-512 MB tier. Shopify has no practical product limit. The capacity question stops existing. |
| **Images natively on `cdn.shopify.com`** | Matches your own rule that the storefront serves from Shopify's CDN. No Cloudinary staging step, no `assetMirrors` collection (85,162 docs, 27 MB of indexes). |
| **Inventory, orders, customers, discounts built in** | Already partly used. Webhooks keep it current without a sync job. |
| **No Atlas bill, no cluster tier decision** | One less piece of infrastructure to size and monitor. |

---

## What breaks

### 1. Your product model does not fit Shopify's

`src/models/Product.ts` has **191 top-level fields**. A Shopify product has roughly six that matter: title, description, images, options, variants, tags. Everything else becomes a metafield.

Structures with nowhere natural to go:

`productSections` · `attributes` (spec tables) · `technicalDrawings` · `swatchGroups` · `nestedOptions` · `addonGroups` · `optionElements` · `configurator` data · `pergolaSizeRows` · `flashingFinder` · `doTheJobRight` · `areaCalculator` · `packCoverageM2` · `tierPrices` · supplier-specific section blocks (Otto, Pooky, UFHS, Britmet)

These can be stored as metafields, but see the next point.

### 2. Metafields must be named explicitly in every query

This is the wall I hit while building the per-brand Shopify switch. The Storefront API does not return metafields unless the GraphQL query lists each one by namespace and key. A metafield you forget to name is invisible — the page renders blank, with no error.

Your current read query (`src/lib/shopify/storefront.ts`, `PRODUCT_CARD_FIELDS`) asks for **no metafields at all**, `images(first: 10)` and `variants(first: 1)`. Every field you migrate has to be added to a query, and every query pays for it in complexity cost.

### 3. Filtering and facets

`computeCatalogFacetCounts` (`src/app/actions/products.ts:1368`) builds facet counts with a Mongo aggregation over arbitrary fields — size buckets, price-per-m², colour groups, departments, sub-brands.

Shopify Storefront filtering only works through `productFilters` on a collection, with a fixed set of filter types. Arbitrary aggregation across your own taxonomy is not available. You would rebuild faceting on Shopify tags and metafields, with less flexibility, and tags are flat strings.

### 4. Sorting and pagination

Your listing uses offset pagination with arbitrary sorts (`LISTING_PAGE_SIZE = 36`, skip/limit, sort by price/date/name). The Storefront API is **cursor-paginated** with a fixed set of sort keys. "Jump to page 7 of Baths sorted by price ascending" has no direct equivalent — it has to be walked from the start, or reworked into infinite scroll.

### 5. Checkout pricing is Linx logic, not Shopify logic

`src/app/api/checkout/shopify/route.ts` already tells this story. The comment in that file says the Storefront cart was abandoned because Shopify prices delivery itself and **"the shop rates cannot express the Linx rule"** — every basket goes through a draft order instead.

Pricing that lives in your code, not Shopify's:

- trade account discounts (`src/lib/trade.ts`, approval flow, per-account ratios)
- VAT rules (`src/lib/vat.ts`)
- delivery zones (`src/lib/deliveryZones.ts`), shipping bands (`src/lib/shipping.ts`)
- made-to-measure / configured pricing (`src/lib/configuredPrice.ts`) — lines whose price is *not* any variant's price
- per-brand calculators (tiles, UFH, Spectra Larsen, Pooky)

A configured line has no SKU and no variant. Shopify's cart cannot express it. That is a hard architectural limit, not a gap you fill in later.

### 6. It is not only products

Your database is 22 collections. Shopify covers some of them; these have no Shopify equivalent:

`purchaseorders` · `suppliers` · `productsuppliers` · `suppliersynclogs` · `configuratorcategories` · `configuratormtomaps` · `assetMirrors` (85,162 docs) · `menus` (2,031 docs) · `contactqueries` · `wishlists`

The `menus` tree in particular drives your mega-menu. Shopify collections are flat membership lists — they cannot represent a column/group/subcategory tree.

### 7. Runtime cost and latency

Every page render becomes external API calls against a cost-budgeted API, instead of local database queries. A 36-row listing that is one Mongo query today becomes batched Storefront calls. Page latency goes up, and heavy traffic starts competing with your own API budget.

### 8. Lock-in

Leaving Shopify later means rebuilding the catalogue layer a second time.

---

## Effort estimate

| Area | Work |
|---|---|
| Listing, facets, search, sort/pagination | Rewrite |
| PDP and all supplier-specific sections | Rewrite as metafield round-trips |
| Checkout, trade pricing, configured lines | Rework, some of it not expressible |
| Menus / mega-menu | Rebuild or keep Mongo anyway |
| Admin (products, suppliers, POs, configurator) | Rebuild or keep Mongo anyway |
| Data migration | 27,594 products + metafields, multi-day push |

Realistically **weeks to months**, and the likely outcome is a hybrid anyway — because menus, suppliers, purchase orders and the configurator have to live somewhere.

---

## Where this option *does* make sense

Not for the whole catalogue — but **per brand**, which is what the switch I already built does:

- `Brand.catalogSource: "shopify"` (added, defaults to `"mongo"`, no migration)
- `src/lib/shopifyOwnedBrands.ts` — cached set of switched-over brands
- `fetchStorefrontProductsFull()` — richer query with metafields, 50 images, 100 variants, batched
- `enrichFromStorefront` branches on it; every other brand runs the original code path untouched

A brand that is self-contained, has no configurator, no calculators and no made-to-measure lines — **Drench is exactly that shape** — can be served from Shopify without disturbing the other 27. That gets you the storage relief without the rewrite.

---

## Recommendation

**Do not move the whole catalogue to Shopify.** The blocker is not product data, it is trade pricing, configured lines, faceting and the menu tree — all of which are Linx logic that Shopify has no vocabulary for.

If the driver is storage, that problem is worth ~£20–60/month of cluster tier, not a multi-week rewrite. See Report 2.

If the driver is *this brand specifically*, use the per-brand switch that already exists.
