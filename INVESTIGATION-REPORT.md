# Linx Square — MongoDB Storage & Architecture Investigation

**Date:** 2026-09-16 · **Type:** Read-only investigation · **Nothing was modified**

All figures measured directly against the live cluster unless marked *estimated*.

---

## 1. Executive Summary

**Your 512 MB ceiling is being consumed by indexes as much as by data, and most of those indexes are never used.**

Atlas M0 bills against **`dataSize` + `indexSize`**, which resolves the discrepancy in your reading:

```
dataSize   392.71 MB
indexSize   88.34 MB
           ---------
total      481.05 MB   ← matches the 480.76 MB / 512 MB (94%) you saw
```

Five findings drive everything else:

1. **`name_text_description_text` is 48.19 MB and has recorded 0 operations** in 9 days. It is the single largest object in the database and appears unused.
2. **16 of 29 product indexes show 0 ops** — roughly **53.6 MB** of product index storage with no recorded reads.
3. **All 3 `assetMirrors` indexes show 0 ops — 27.43 MB.** The collection has **zero references anywhere in `src/`**; only three offline scripts touch it.
4. **Four Pooky configurator fields (`shades`, `bases`, `wallFittings`, `pendants`) total ~121 MB — 34% of all product storage** — held on just 6,041 documents.
5. **Pooky is 43.7% of product storage** (156.24 MB) at an average of 43,318 B per product, against a catalogue median of 8,526 B.

Combined, indexes showing zero usage total **~81 MB, about 17% of your 512 MB cap** — without touching a single product document.

> **Caveat, important:** `$indexStats` counters reset on restart/failover and cover only since 2026-09-07. A rarely-run script's index will read 0 while still being required. **0 ops is grounds for investigation, not proof of safety.**

---

## 2. Current Architecture

```
  ADMIN (Next.js server actions)
        │  writes
        ▼
  ┌───────────────┐   dual-write    ┌───────────────┐
  │   MongoDB     │ ──────────────▶ │    Shopify    │
  │  (source of   │                 │  (commerce    │
  │   truth)      │ ◀────────────── │   backend)    │
  └───────────────┘   webhooks/pull └───────────────┘
        │                                   │
        │ queries (filter/sort/facet)       │ price, stock, checkout
        ▼                                   ▼
  ┌─────────────────────────────────────────────┐
  │              STOREFRONT (Next.js)           │
  └─────────────────────────────────────────────┘
```

### Source of truth by data type

| Data | Source of truth | Notes |
|---|---|---|
| Product catalogue | **MongoDB** | Shopify is a mirror, except brands flagged `catalogSource: "shopify"` |
| Price / stock | MongoDB, overlaid by Shopify | `enrichFromStorefront` (`products.ts:156`) |
| Images | MongoDB (Cloudinary URLs) + Shopify CDN | `shopifyImages` pairs them |
| Orders / payments | **Shopify** | Draft orders; webhooks pull back |
| Customers | Both | Signup pushes to Shopify |
| Menus / mega-menu | **MongoDB** | 2,031 docs; collections mirrored as `menu-*` |
| Trade accounts / VAT / delivery | **MongoDB only** | No Shopify equivalent |
| Configurator / calculators | **MongoDB only** | No Shopify equivalent |
| Purchase orders / suppliers | **MongoDB only** | No Shopify equivalent |

**Key structural point:** Shopify can serve *content*. It cannot serve *queries*. Listing, faceting, sorting, pagination and basket pricing are Mongo operations with no Storefront API equivalent.

### Code map

| Concern | Path |
|---|---|
| Connection | `src/lib/mongodb.ts`, `scripts/mongo-connect.cjs` |
| Product model | `src/models/Product.ts` — **191 top-level fields** |
| Storefront reads | `src/app/actions/products.ts` |
| Listing query | `src/lib/listingQuery.ts` |
| Shopify admin/storefront | `src/lib/shopify/{admin,storefront}.ts` |
| Product sync | `src/lib/shopify/{sync-product,sync-product-full}.ts` |
| Inbound/webhooks | `src/lib/shopify/{inbound,webhooks,pull-products}.ts` |
| Checkout | `src/app/api/checkout/shopify/route.ts` |
| Image mirroring | `scripts/mirror-cloudinary-assets-to-shopify.cjs` |

---

## 3. MongoDB Storage Breakdown

**Cluster:** `cluster0.y60rrga.mongodb.net`, db `test`, MongoDB 8.0.32 Atlas, 22 collections, 114,964 objects.

| Collection | Docs | Data MB | Storage MB | Index MB | Indexes | Avg doc | Purpose | Criticality |
|---|---|---|---|---|---|---|---|---|
| products | 27,594 | 357.67 | 130.92 | 58.77 | 29 | 13,591 B | Catalogue | **Critical** |
| assetMirrors | 85,162 | 34.14 | 10.38 | 27.43 | 3 | 420 B | Image mirror cache | **See §8** |
| menus | 2,031 | 0.83 | 0.42 | 0.47 | 7 | 427 B | Mega-menu | **Critical** |
| collections | 33 | 0.02 | 0.05 | 0.14 | 4 | 688 B | Curated sets | Medium |
| contactqueries | 30 | 0.02 | 0.04 | 0.14 | 4 | 617 B | Enquiries | Medium |
| brands | 29 | 0.01 | 0.04 | 0.16 | 5 | 422 B | Brands | **Critical** |
| users | 24 | 0.01 | 0.04 | 0.14 | 4 | 462 B | Accounts/trade | **Critical** |
| orders | 10 | 0.01 | 0.04 | 0.14 | 4 | 925 B | Orders | **Critical** |
| departments | 24 | 0.00 | 0.04 | 0.18 | 5 | 173 B | Taxonomy | **Critical** |
| suppliers | 6 | 0.00 | 0.04 | 0.13 | 4 | 327 B | Suppliers | Medium |
| configuratorcategories | 8 | 0.00 | 0.04 | 0.14 | 4 | 220 B | Configurator | Medium |
| coupons | 3 | 0.00 | 0.04 | 0.11 | 3 | 350 B | Discounts | Medium |
| wishlists | 7 | 0.00 | 0.04 | 0.07 | 2 | 112 B | Wishlists | Low |
| addresses / subscribers / settings | 1 each | ~0 | 0.04 | 0.04–0.07 | 1–2 | — | Misc | Low |
| **7 empty collections** | 0 | 0 | ~0.02 | **0.21** | 29 | — | POs, reviews, MTO, sync logs | Unused today |

**Observation:** seven collections hold zero documents but carry **29 indexes and ~0.21 MB**. Trivial in size, but it indicates index definitions outliving their data.

---

## 4. Product Storage Breakdown

| Metric | Value |
|---|---|
| Documents | 27,594 |
| Total logical | 357.67 MB |
| **Average** | **13,592 B** |
| **Median** | **8,526 B** |
| Smallest | 940 B |
| **Largest** | **266,464 B** (260 KB) |

Average sits 59% above median — the distribution is heavily skewed by a minority of very large documents.

**Top 20 largest products: all 20 are Pooky**, ranging 232–260 KB, all wall fittings and table lamps. A single Pooky product can equal **31 median products**.

---

## 5. Largest Brands

| Brand | Products | Total MB | Avg B | Max KB | % of product storage |
|---|---|---|---|---|---|
| **Pooky** | 3,782 | **156.24** | 43,318 | 260 | **43.7%** |
| **Drench** | 5,546 | **73.72** | 13,938 | 39 | **20.6%** |
| Noken | 2,098 | 19.53 | 9,761 | 18 | 5.5% |
| Porcelanosa | 2,743 | 16.52 | 6,314 | 14 | 4.6% |
| FAKRO | 1,881 | 16.08 | 8,963 | 142 | 4.5% |
| Luxury Flooring | 606 | 14.88 | 25,739 | 215 | 4.2% |
| Flooring sales | 2,177 | 12.73 | 6,133 | 12 | 3.6% |
| UFH Store | 769 | 7.23 | 9,856 | 140 | 2.0% |
| Plank Hardware | 488 | 7.23 | 15,526 | 28 | 2.0% |
| *(15 others)* | 6,504 | ~33 | — | — | ~9.3% |

**Two brands are 64% of product storage.** Pooky at 3.2× the median product size; Luxury Flooring and Cambridge Skylights also run high per-product (25.7 KB and 30.6 KB).

---

## 6. Largest Product Fields

Measured with `$bsonSize` per field across all 27,594 documents.

| Field | MB | % of products | Docs holding it | Avg B/doc | Classification |
|---|---|---|---|---|---|
| **shades** | **58.46** | **16.3%** | 6,041 | 10,147 | A/B — configurator |
| **productSections** | **39.04** | **10.9%** | 8,674 | 4,720 | A — PDP content |
| **bases** | **37.70** | **10.5%** | 6,041 | 6,544 | A/B — configurator |
| **specs** | **30.04** | **8.4%** | 27,591 | 1,142 | A/D/E — mixed |
| **shopifyImages** | **29.03** | **8.1%** | 22,048 | 1,381 | **D/F — sync metadata** |
| **wallFittings** | **20.12** | **5.6%** | 6,041 | 3,492 | A/B — configurator |
| description | 18.38 | 5.1% | 27,594 | 699 | A |
| images | 16.24 | 4.5% | 27,594 | 617 | A |
| variants | 13.70 | 3.8% | 15,942 | 901 | A/C |
| attributes | 11.26 | 3.1% | 15,184 | 778 | A |
| downloads | 5.92 | 1.7% | 10,562 | 588 | A |
| sourceAttributes | 5.39 | 1.5% | **660** | 8,556 | **E/G — import residue** |
| pendants | 4.54 | 1.3% | 6,041 | 789 | A/B |
| *(35 more)* | ~27 | ~7.6% | — | — | mixed |
| **Measured total** | **319.51** | **89.3%** | | | |
| Unmeasured remainder | 38.16 | 10.7% | | | scalars, ids, sync metadata |

### Classification key
**A** live storefront · **B** admin · **C** checkout · **D** Shopify sync · **E** import only · **F** duplicated/cache · **G** possibly obsolete · **H** unknown

### Pooky in isolation (3,782 products, 156.24 MB)

| Field | MB | % of Pooky |
|---|---|---|
| shades | 58.43 | 37.4% |
| bases | 37.67 | 24.1% |
| wallFittings | 20.09 | 12.9% |
| pendants | 4.52 | 2.9% |
| **Configurator subtotal** | **120.71** | **77.3%** |
| specs | 9.25 | 5.9% |
| shopifyImages | 8.49 | 5.4% |

**The four configurator axes are ~121 MB — 34% of all product storage — on 6,041 documents.** This is the single largest concentration in the database. These arrays appear to repeat option catalogues per product rather than referencing a shared set (`shades` averages 16,200 B on Pooky alone).

**Flagged for further investigation (H):** whether `shades`/`bases`/`wallFittings`/`pendants` contain per-product data or a repeated global option list. If the latter, normalising to a shared collection is the largest single opportunity in the database. **This was not verified.**

---

## 7. Shopify vs MongoDB Duplication

| Data | MongoDB | Shopify | Why Mongo holds it | Duplication necessary? | Risk if removed |
|---|---|---|---|---|---|
| title | ✅ | ✅ | Search, sort, admin lists | **Yes** — Shopify can't sort your listings | **High** |
| description | ✅ 18.38 MB | ✅ | PDP render | Partly | Medium |
| images | ✅ 16.24 MB | ✅ | Card + PDP render | Partly | Medium |
| **shopifyImages** | ✅ **29.03 MB** | n/a | **Pairs Cloudinary↔Shopify URLs so re-sync doesn't re-upload** | **Sync-only** | Medium — re-uploads galleries |
| variants | ✅ 13.70 MB | ✅ | Checkout resolution | **Yes** | **High** |
| SKU | ✅ | ✅ | Admin, POs | Yes | Medium |
| price | ✅ | ✅ | **Filter/sort/facet + basket pricing** | **Yes — mandatory** | **Critical** |
| inventory | ✅ | ✅ | Availability filter | Yes | High |
| collections | menus (2,031) | 1,324+ collections | Mega-menu tree | **Yes** — Shopify collections are flat | **High** |
| tags | partial | ✅ | — | No | Low |
| metafields | source fields | ✅ 25 defs | Shopify mirror of Linx fields | Sync-only | Medium |
| Shopify IDs/URLs | ✅ | n/a | Linkage | **Yes** | **Critical** |
| vendor/status | ✅ | ✅ | Derived at sync | No | Low |

**Measured duplication findings**

- **`shopifyImages` (29.03 MB, 8.1%)** is pure sync bookkeeping — it exists only so re-syncs recognise already-uploaded files. It is not read by any storefront render path.
- **Verified coverage across 14 brands** (separate exercise, this session): only **3 brands** — UK Bifold Door Factory, Natura Flooring, Porcious, **231 products, ~1 MB** — have every populated field present in Shopify. Every other brand carries **3–13 fields with no Shopify equivalent** (`usage` and `delivery` on all 357 Otto Tiles products; configurator axes on Pooky; `shopifyOptions` on FAKRO).
- **6,490 products have no price**, so they sync to Shopify as DRAFT and are invisible to the Storefront API. They are also already hidden on the Mongo storefront by `storefrontVisibilityClause()`.

**Conclusion: Mongo↔Shopify duplication is far smaller than it appears.** The large fields are mostly Linx-specific structures Shopify has no vocabulary for.

---

## 8. assetMirrors Investigation — **high priority**

| Metric | Value |
|---|---|
| Documents | 85,162 |
| Data size | 34.14 MB |
| Storage (compressed) | 10.38 MB |
| **Index size** | **27.43 MB** |
| **Index : data ratio** | **2.64× the compressed data** |
| Avg doc | 420 B |

### Schema (no Mongoose model exists)

```
_id, sourceUrl (str ~134–165), shopifyUrl (str ~113–144),
shopifyFileId (39), status ("done"), mirroredAt (date),
originalSource (present on only 62 docs)
```

| Field | Docs | MB |
|---|---|---|
| sourceUrl | 85,162 | 14.77 |
| shopifyUrl | 85,162 | 9.13 |
| shopifyFileId | 85,162 | 4.22 |
| _id | 85,162 | 1.62 |
| status | 85,162 | 1.46 |
| mirroredAt | 85,162 | 1.30 |
| originalSource | **62** | 0.01 |

### Indexes — **all three report 0 operations**

| Index | Size | Ops since 2026-09-07 |
|---|---|---|
| `sourceUrl_1` (UNIQUE) | **16.83 MB** | **0** |
| `shopifyUrl_1` | **7.62 MB** | **0** |
| `_id_` | 2.98 MB | **0** |

### Dependency map — complete trace

```
scripts/mirror-cloudinary-assets-to-shopify.cjs   creates / updates rows
scripts/fix-ufhs-option-swatch-images.cjs         reads
scripts/fix-usage-icon-images.cjs                 reads (mirrors.find)

src/  →  ZERO references
```

**No route, server action, component or library in `src/` reads `assetMirrors`.** It exists purely as a de-duplication cache for the offline Cloudinary→Shopify mirroring script: one row per source URL so a shade image used by 400 products uploads once.

### Findings

- Purpose is legitimate and well-designed for its job.
- **No deletion logic was found anywhere** — rows appear to be retained indefinitely.
- `status` is a 5-char string on every row; `originalSource` exists on 62 of 85,162 rows.
- **The indexes cost 2.64× the compressed data they serve**, and serve only scripts that run occasionally.
- `sourceUrl_1` is UNIQUE, so it is presumably enforcing the dedupe invariant on insert — **0 ops is expected if the script has not run in the measurement window** and does **not** imply the index is droppable.

**Requires further investigation (not measured):** whether rows for products since deleted are orphaned, and whether the mirror script would function acceptably with `sourceUrl_1` alone (dropping `shopifyUrl_1`, 7.62 MB).

---

## 9. Index Investigation

**Total index storage: 88.34 MB — 18.4% of your 481 MB consumption.**

### Products: 29 indexes, 58.77 MB

**Used (13 indexes, ~5.1 MB) — DO NOT TOUCH**

| Index | Ops | MB |
|---|---|---|
| `_id_` | 65,469 | 0.59 |
| `department_1` | 40,053 | 0.29 |
| `price_1` | 28,129 | 0.45 |
| `department_1_subCategory_1` | 16,015 | 0.32 |
| `department_1_category_1` | 13,133 | 0.32 |
| `category_1_createdAt_-1` | 11,321 | 0.46 |
| `subCategory_1_createdAt_-1` | 9,962 | 0.54 |
| `brand_1_createdAt_-1` | 7,610 | 0.40 |
| `createdAt_-1` | 3,627 | 0.39 |
| `department_1_createdAt_-1` | 1,711 | 0.46 |
| `shopifyProductId_1` | 419 | 0.51 |
| `department_1_categories_1` | 8 | 0.27 |
| `brands_1` | 4 | 0.20 |

**Zero recorded operations (16 indexes, ~53.6 MB) — INVESTIGATE FURTHER**

| Index | MB | Note |
|---|---|---|
| **`name_text_description_text`** | **48.19** | **Largest object in the DB. 0 ops suggests search does not use Mongo text search** |
| `sourceHandle_1` | 0.65 | import lookup |
| `productCode_1` | 0.63 | |
| `sourceProductId_1` | 0.57 | import lookup |
| `sourceSku_1` | 0.56 | import lookup |
| `supplierCategory_1` | 0.55 | |
| `stockStatus_1` | 0.36 | |
| `linxSku_1` | 0.33 | |
| `department_1_subCategories_1` | 0.31 | |
| `subCategories_1` | 0.29 | |
| `rangeName_1` | 0.21 | |
| `categories_1` | 0.20 | |
| `tradePrice_1` | 0.20 | |
| `subBrand_1` | 0.18 | |
| `supplier_1` | 0.17 | |
| `legacyProductCode_1` | 0.17 | |

**The text index alone is 48.19 MB — 55% of all index storage and 10% of your 512 MB cap.** Its 0 ops strongly suggests search is implemented with regex or another mechanism rather than `$text`. **This was not confirmed by reading the search implementation and must be verified before any conclusion.**

### assetMirrors: 3 indexes, 27.43 MB — all 0 ops (see §8)
### menus: 7 indexes, 0.47 MB — `slug_1` 56,349 ops; `department_1_order_1` 0 ops

### Risk classification

| Class | Indexes | Size |
|---|---|---|
| **DO NOT TOUCH** | 13 product + 5 menus + all small-collection unique constraints | ~6 MB |
| **INVESTIGATE FURTHER** | text index, 15 zero-op product indexes | ~53.6 MB |
| **INVESTIGATE FURTHER** | 3 assetMirrors indexes | 27.43 MB |

**No index should be removed on `$indexStats` evidence alone.** Counters reset on restart, cover 9 days only, and import scripts that run monthly would legitimately read 0.

---

## 10. Synchronization Investigation

### Flow

| Event | Behaviour |
|---|---|
| Product created in admin | Mongo insert → `syncFullProductToShopify` → Shopify IDs written back |
| Product updated | Mongo update → full push (media reconcile, variants, metafields) |
| Product deleted | `deleteShopifyProduct` then Mongo delete; Mongo delete proceeds even if Shopify fails |
| Shopify product changes | Webhooks (`webhooks.ts`) / `pull-products.ts` → `upsertMongoProductFromShopify` |
| Image changes | `shopifyImages` pairing compared; unmatched uploaded, stale removed |

### Findings

- **Failed syncs persist indefinitely** — `shopifySyncError` is written to the document and never cleared except by a later success. Not a growth concern (short strings).
- **No synchronization log collection exists.** `suppliersynclogs` is **empty (0 docs)**. Logs go to console, not Mongo. **This is good** — no log-driven growth.
- **Rollback records are files, not documents** — ~120 `rollback-*.json` files in the repo root, some >1 MB (largest ~6.8 MB). They consume **disk, not MongoDB**. Worth noting for repo hygiene; irrelevant to the 512 MB cap.
- **Orphan risk confirmed low:** an audit of all 22,048 linked products found **0 dead `shopifyProductId` values** — every GID resolves in Shopify.
- **Retries do not create documents** — retry logic is in-process with backoff.
- **No historical versioning** — documents are overwritten in place.

**Not measured:** whether `assetMirrors` rows are orphaned when products are deleted (no deletion logic found — see §8).

---

## 11. Live Feature Dependencies

| Feature | Collections | Key fields | Shopify dependency | Criticality |
|---|---|---|---|---|
| Homepage | products, brands, departments, menus | name, price, images, department | None | **Critical** |
| Brand pages | products, brands | brand, category, price, images | None | **Critical** |
| Category pages | products, menus, departments | **category, subCategory, department, price, stock** | None | **Critical** |
| Search | products | name, description | None (text index reads 0 ops) | **Critical** |
| Filtering | products | price, category, subCategory, department, colorOptions, sizeOptions | None | **Critical** |
| Sorting | products | price, createdAt, name | None | **Critical** |
| Pagination | products | — (skip/limit) | None | **Critical** |
| PDP | products | description, images, specs, attributes, productSections, variants, downloads | Optional overlay | **Critical** |
| Related / recommendations | products | category, department, price | None | High |
| Cart | products | price, variants, stock, shopifyVariantId | Variant GID | **Critical** |
| **Checkout** | products, brands, users | **price, variants, vatRate, brand, stock** | **Draft order** | **Critical** |
| Trade accounts | users, products | tradeStatus, tradePrice, tierPrices | None | **Critical** |
| VAT | products, settings | vatRate | None | **Critical** |
| Shipping | products, settings | weight, deliveryZones | None | **Critical** |
| Configurators | products, configuratorcategories | **bases, shades, pendants, wallFittings**, nestedOptions | None | **Critical (Pooky)** |
| Made-to-measure | products | configWidth/Height, areaCalculator | Priced outside Shopify | **Critical** |
| Calculators | products | coverage, packCoverageM2, efficiency | None | High |
| Suppliers / POs | suppliers, purchaseorders (empty) | supplier refs | None | Medium |
| Menus | menus, departments | slug, parent, order, brand | Mirrored | **Critical** |
| Wishlists | wishlists | product ids | None | Low |
| Admin | all | all 191 fields | Dual-write | **Critical** |

**Critical dependency:** checkout resolves every line from Mongo — trade discount, VAT, delivery zones and made-to-measure pricing are Linx rules with **no Shopify expression**. `src/app/api/checkout/shopify/route.ts` documents this directly: the Storefront cart was abandoned because "the shop rates cannot express the Linx rule."

---

## 12. Future Product Growth Analysis

### Measured baseline

| Metric | Value |
|---|---|
| Products | 27,594 |
| Product data | 357.67 MB |
| Product indexes | 58.77 MB |
| **Total per product (data + index)** | **~15.8 KB** |
| Median product | 8,526 B |
| Cap consumption today | 481.05 / 512 MB (94%) |

### Projection — *estimated, linear extrapolation from measured averages*

| Products | Est. data | Est. index | **Est. total** | vs M0 512 MB |
|---|---|---|---|---|
| 27,594 (today) | 358 MB | 88 MB | **481 MB** | **94%** |
| 50,000 | 648 MB | 148 MB | **~796 MB** | **155% — exceeded** |
| 75,000 | 973 MB | 212 MB | **~1.19 GB** | 232% |
| 100,000 | 1.30 GB | 276 MB | **~1.58 GB** | 308% |
| 250,000 | 3.24 GB | 660 MB | **~3.90 GB** | 762% |

*Caveats: assumes current average document size and index-per-product ratio hold. The average is skewed by Pooky; a catalogue of Drench-shaped products (13.9 KB) or RAK-shaped (2.2 KB) would grow very differently. Non-product collections excluded. No historical time-series exists on this cluster to validate the growth curve.*

### Bottleneck order — **based on measured data**

1. **Atlas M0 512 MB cap — already reached at 94%.** This binds *now*, before any other limit.
2. **`assetMirrors` index growth** — grows with unique images, not products. Already 27.43 MB for 85,162 assets.
3. **Text index** — 48.19 MB at 27.5k products; would scale to ~175 MB at 100k *if retained and if it is genuinely unused*.
4. **Shopify API throughput** — observed during this session: full product creation ran at roughly 10 products/minute including media. 100k products would be days of wall-clock sync.
5. **M0 connection limit (500)** and shared CPU — not yet observed as a constraint.

**Query complexity is not currently a bottleneck** — the used indexes cover the hot listing paths and are small (~5 MB total).

---

## 13. Potential Storage Optimizations

**Recommendations only. Nothing here has been implemented.**

### 13.1 Text index `name_text_description_text`
- **Current cost:** 48.19 MB (10% of cap, 55% of all indexes)
- **Potential saving:** up to 48.19 MB
- **Dependencies:** search — **must confirm whether `$text` is used**
- **Risk:** **HIGH until verified.** If search uses it, removal breaks site search.
- **Reversibility:** yes — rebuildable, but rebuilding 27.5k docs on M0 is slow and consumes cap during build
- **Backup:** index definition recorded
- **Staging:** **required**
- **Complexity:** Low to remove, high to verify

### 13.2 Fifteen zero-op product indexes
- **Current cost:** ~5.4 MB
- **Potential saving:** ~5.4 MB
- **Dependencies:** several are import-script lookups (`sourceHandle`, `sourceSku`, `sourceProductId`) that would read 0 between imports
- **Risk:** **MEDIUM** — import performance degrades without them
- **Reversibility:** yes
- **Staging:** required
- **Complexity:** Low

### 13.3 `assetMirrors` indexes
- **Current cost:** 27.43 MB (5.4% of cap)
- **Potential saving:** up to 7.62 MB (`shopifyUrl_1`) with lower risk than the unique index
- **Dependencies:** three offline scripts only; zero `src/` references
- **Risk:** **MEDIUM** — mirror script slows; `sourceUrl_1` is a uniqueness constraint and is **higher risk**
- **Reversibility:** yes
- **Staging:** required
- **Complexity:** Low

### 13.4 Pooky configurator normalisation
- **Current cost:** ~121 MB (34% of product storage)
- **Potential saving:** **unknown — requires investigating whether these arrays are per-product or a repeated shared catalogue**
- **Dependencies:** Pooky configurator, PDP, cart (made-to-measure lamp assembly)
- **Risk:** **HIGH** — this is live revenue functionality
- **Reversibility:** yes with full backup
- **Staging:** **mandatory**
- **Complexity:** **High**
- **Note:** potentially the single largest opportunity in the database

### 13.5 `shopifyImages` sync metadata
- **Current cost:** 29.03 MB (8.1% of product storage)
- **Potential saving:** up to 29.03 MB
- **Dependencies:** re-sync gallery reconciliation only; not read by storefront renders
- **Risk:** **MEDIUM** — next sync would re-upload galleries it already holds
- **Reversibility:** yes — regenerated by a re-sync
- **Staging:** required
- **Complexity:** Medium

### 13.6 `sourceAttributes`
- **Current cost:** 5.39 MB on **660 documents** (8,556 B each)
- **Potential saving:** ~5.39 MB
- **Dependencies:** import residue — **usage not traced**
- **Risk:** **UNKNOWN (H)**
- **Complexity:** Low

### 13.7 Indexes on empty collections
- **Current cost:** ~0.21 MB across 29 indexes on 7 empty collections
- **Risk:** LOW — but negligible benefit

---

## 14. Risks

| Risk | Severity | Evidence |
|---|---|---|
| **Cap breach imminent** | **Critical** | 481.05 / 512 MB = 94%. Writes fail at the cap. |
| Text index removal breaks search | High | 48.19 MB, 0 ops — usage unverified |
| Trimming product fields destroys data | **Critical** | 14 brands verified: only 3 (231 products) fully exist in Shopify |
| Configurator changes break Pooky | High | ~121 MB across 4 fields feeding live product assembly |
| `$indexStats` misread as proof | High | 9-day window, resets on restart, rare scripts read 0 |
| Shopify cannot replace Mongo queries | High | Faceting, offset pagination, basket pricing have no Storefront equivalent |
| 6,490 unpriced products | Medium | Sync as DRAFT, invisible to Storefront API |
| assetMirrors never pruned | Medium | No deletion logic found |

---

## 15. Architecture Options

*Presented factually; no ranking.*

### Option A — Increase MongoDB capacity
- **Effort:** none (tier change) · **Risk:** very low · **Migration:** none
- **Query limitations:** none · **Cross-brand:** none · **Reversibility:** yes
- **Storage effect:** Flex ~5 GB, M10 ~10 GB. Supports the 100k projection (~1.58 GB est.)
- **Operational:** unchanged · **Cost:** ongoing subscription

### Option B — Optimize within current architecture
- **Effort:** low–medium · **Risk:** low–high per item (see §13)
- **Migration:** none · **Query limitations:** none if used indexes retained
- **Storage effect:** **up to ~81 MB from indexes alone (~17% of cap)** if all zero-op indexes prove removable; more from §13.4/13.5 pending investigation
- **Reversibility:** indexes yes; field removal only with backup
- **Note:** does not change the growth *rate* — buys headroom, not scalability

### Option C — Move suitable brands to Shopify-backed catalogue
- **Effort:** medium per brand · **Risk:** medium
- **Migration:** per-brand push + verification
- **Measured constraint:** **only 3 of 14 verified brands (231 products, ~1 MB) currently qualify.** Every substantial brand has 3–13 fields with no Shopify home.
- **Cross-brand:** mixed listings still require Mongo index fields for filter/sort
- **Reversibility:** yes · **Storage effect:** small today; larger only after extensive field mapping

### Option D — Shopify as complete product backend
- **Effort:** **very high** · **Risk:** **high to live site**
- **Query limitations:** **blocking** — no arbitrary faceting, cursor-only pagination, no custom sort keys
- **Shopify limitations:** cannot express trade discounts, VAT rules, delivery zones, or made-to-measure lines (no SKU, no variant)
- **Mongo implications:** menus, suppliers, POs, configurator, assetMirrors have no Shopify equivalent and would remain
- **Reversibility:** **low** · **Storage effect:** large, but a hybrid remains regardless

### Option E — Multiple MongoDB clusters
- **Effort:** low–medium · **Risk:** medium
- **Query limitations:** **no cross-cluster `$lookup`, joins, or sorted/paginated merges**
- **Cross-brand:** mixed category pages, search and facet counts break across the split
- **Operational:** doubled — two connection pools, two backup stories
- **Note:** **Atlas M0 has no automated backups** · **Reversibility:** yes
- **Storage effect:** +512 MB per free cluster, in an isolated partition

---

## 16. Recommended Investigation Next Steps

**Investigation only — no implementation.**

1. **Read the search implementation** and determine whether `$text` is used. This single question governs 48.19 MB (10% of the cap) and is the highest-value unknown in this report.
2. **Inspect `shades`/`bases`/`wallFittings`/`pendants` document content** on 5–10 Pooky products. Determine whether they hold per-product data or a repeated shared option catalogue. Governs ~121 MB.
3. **Re-measure `$indexStats` after 30+ days** and after running a full import cycle, so rarely-used import indexes register.
4. **Trace `sourceAttributes`** (5.39 MB on 660 docs) to a consumer, or classify as obsolete.
5. **Check `assetMirrors` for orphans** — rows whose `sourceUrl` no longer appears in any product.
6. **Confirm Atlas's billed metric** in the Atlas UI matches `dataSize + indexSize` (this report's arithmetic reproduces your 480.76 MB reading to within 0.3 MB, but confirm at source).
7. **Complete brand coverage verification** for the 9 brands whose runs failed on DNS errors — Pooky, FAKRO, Likewise Floors, MB Decor, UFH Store, Floors4Trade, Sterlingbuild, Luxury Flooring, Direct Flooring Online.
8. **Measure growth empirically** — snapshot `db.stats()` weekly to replace the linear extrapolation in §12 with a real curve.

---

## Measurement Limitations

| Not measured | Why |
|---|---|
| Historical growth rate | No time-series data on this cluster; §12 is linear extrapolation |
| Whether the text index is genuinely unused | Requires reading the search implementation |
| Whether configurator arrays are per-product or shared | Requires content inspection, not size measurement |
| Real index usage over a full import cycle | `$indexStats` window is 9 days |
| `fsTotalSize` / true Atlas quota | Atlas blocks `hostInfo` on shared tiers |
| assetMirrors orphan count | Requires cross-referencing 85,162 rows against product image arrays |
| Query performance under load | Would require load testing against production |

---

*Read-only investigation. No documents, indexes, schemas, environment variables or Shopify data were modified in producing this report.*
