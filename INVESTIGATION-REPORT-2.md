# SECOND READ-ONLY INVESTIGATION REPORT

**Date:** 2026-09-16 · **Scope:** five unresolved questions from the first report · **Nothing was modified**

---

## 1. Executive Summary

**Largest confirmed storage opportunity — the text index, 48.19 MB (10% of your 512 MB cap).**
This is now proven, not inferred. `$text` appears **nowhere** in the repository. Customer search and admin search both use `$regex`. In MongoDB a text index is reachable *only* through `$text`, so this index is structurally incapable of serving any query the application makes. This is proof from language semantics, not from `$indexStats`.

**Biggest unresolved risk — the Pooky configurator data is duplicated *and* live-critical at the same time.**
The first report guessed these arrays might be a repeated shared catalogue. Document inspection shows something more awkward: they are heavily duplicated (one `bases` SKU appears **48 times byte-identical except `sortOrder`**; one `wallFittings` SKU appears **78 times**), but they are consumed directly by `PookyConfigurator.tsx` and by `configuredPrice.ts`, which verifies basket prices at checkout. Normalising them touches live revenue logic.

**What appears safe to investigate next —** `sourceAttributes` (5.39 MB) has exactly one writer and **zero readers** anywhere in `src/`, and `assetMirrors`' `shopifyUrl_1` index (7.62 MB) appears to serve a single reporting count, and is **recreated automatically** by the script that uses it.

**What remains unverified —** the schema declares an **8-field** text index while the live index covers only `name + description`; the two do not match and the cause was not established. Orphan rate in `assetMirrors` was still measuring when this report was written.

**A correction to the first report:** it implied the zero-operation indexes were largely redundant. They are not. Every one of the 13 non-text zero-op index fields has real code references — mostly in import scripts that did not run during the 9-day measurement window.

---

## 2. Text Index Investigation

### Actual search implementation

| Layer | File | Mechanism |
|---|---|---|
| Customer search | `src/app/actions/products.ts:407` `getPublicProducts` | `$regex` + `$options:"i"` |
| Admin search | `src/app/actions/admin.ts:210` | `$regex` + `$options:"i"` |
| Search page | `src/app/search/page.tsx` | calls `getPublicProducts` |

The customer search block (`products.ts:740–772`) escapes regex metacharacters, then builds:

```
$or: [ name, sku, productCode, barcode, category,
       subCategory, department, "specs.size" ]   ← all $regex
```

plus per-token `$and` clauses over `name, sku, productCode, barcode, category, subCategory, specs.size`.

### A. Is `$text` used anywhere?

**No.** A repository-wide search for `$text` across `src/` and `scripts/` (`.ts`, `.tsx`, `.cjs`, `.mjs`, `.js`) returns **zero matches** — not in storefront code, not in admin code, not in scripts or tests.

### B. What powers customer-facing search?

**Case-insensitive `$regex`.** Note it does **not** search `description`, even though `description` is half of the live text index.

### C. Why is the text index not used?

**Because it cannot be.** MongoDB text indexes are addressable only through the `$text` operator. A `$regex` predicate can never select a text index, regardless of the fields it covers. With no `$text` in the codebase, no query can reach it.

Secondary finding: `src/models/Product.ts:1347–1356` declares a text index over **eight** fields (`name, description, linxSku, supplierSku, productCode, legacyProductCode, keywords, synonyms`), but the live index is `name_text_description_text` — **two fields**. MongoDB permits only one text index per collection, so Mongoose's attempt to build the 8-field version would conflict with the existing 2-field one. **The cause of the mismatch was not established — NOT VERIFIED.**

### D. What would break if it disappeared?

No application code path that I could locate. Every product query uses `$regex`, equality, or range predicates.

> **NOT VERIFIED:** whether any Mongo shell usage, Atlas Search configuration, BI connector, external tool, or ad-hoc operational query uses `$text`. Code inspection cannot see those.

### E. Storage saving

| | |
|---|---|
| Index size | **48.19 MB** |
| Share of all index storage | **54.6%** of 88.34 MB |
| Share of 512 MB cap | **9.4%** |
| Theoretically removable | Entire index |

**Hidden risk:** Mongoose `autoIndex` defaults to **true** and no `autoIndex: false` was found in `src/lib/mongodb.ts` or the models. If the index were dropped, the next process start would likely attempt to **recreate it from the schema declaration** — and building a text index over 27,594 documents consumes both time and cap while it builds. Any removal plan must address the schema declaration first, not just the index.

### Conclusion

> **`TEXT INDEX APPEARS UNUSED — NEEDS STAGED VALIDATION`**

Code evidence is strong and direct. The remaining unknowns are the autoIndex recreation behaviour and the possibility of out-of-band `$text` usage.

---

## 3. Pooky Configurator Investigation

### Sample methodology

Two independent read-only passes:

1. **80 products** — the 20 largest Pooky documents plus 60 others, hashing whole arrays and individual elements.
2. **150 products** — comparing elements by full content, by content ignoring `price`/`stock`, and by identity (`sku`/`handle`/`name`).
3. A targeted pass isolating repeated SKUs to determine exactly which keys differ.

### Byte-level view (80 products)

| Field | Products | Avg len | Max len | Distinct whole arrays | Unique elements |
|---|---|---|---|---|---|
| shades | 45/80 | 266.1 | **736** | 45 | 99.8% |
| bases | 52/80 | 33.0 | 123 | 46 | 44.7% |
| wallFittings | 42/80 | 19.3 | 97 | 40 | 95.3% |
| pendants | 49/80 | 64.3 | 175 | 49 | 100% |

At byte level the arrays look almost entirely unique. **That reading is misleading.**

### Identity-level view (150 products) — the real picture

| Field | Element slots | Distinct by SKU | Reuse per SKU | Repeated identity slots |
|---|---|---|---|---|
| **bases** | 6,980 | **290 (4.2%)** | **24.07×** | **95.8%** |
| **wallFittings** | 1,105 | **125 (11.3%)** | **8.84×** | **88.7%** |
| **shades** | 2,709 | 903 (33.3%) | 3.00× | 66.7% |
| pendants | 99 | 62 (62.6%) | 1.60× | 37.4% |

**Zero SKUs carry more than one distinct price in any field.** Pricing is global per option, not per product.

### What actually differs between duplicate copies

| Field | Example SKU | Copies | Identical keys | Differing keys |
|---|---|---|---|---|
| **bases** | `TLMON100BRABRA` | **48** | name, handle, sku, price, stock, **images** | **`sortOrder` only** (8 values) |
| **wallFittings** | `WFSWN120BRABRA` | **78** | name, handle, sku, price, stock, sortOrder | **`images` only** (78 variants) |
| shades | `LSEMP216SIVCUT` | 7 | price, handle, sku | name (2), images (7), stock (2), sortOrder (2) |

Element sizes: bases ~261 B, wallFittings ~373 B, shades ~785 B.

### C. What the data model actually is

**A shared option catalogue embedded in full inside every product that offers it, with a per-product sort position.**

- `bases` is the clearest case: 48 byte-identical copies of a 261-byte object whose only variation is an integer sort position.
- `wallFittings` shares everything *except* `images` — every one of 78 copies carries a different images array. **Whether those are genuinely different photographs or the same assets under different URLs/ordering was NOT VERIFIED**, and it determines whether that field can be normalised.
- `shades` sits between: identity and price shared, but `name`, `images` and `stock` vary.

### D. Code that consumes these fields

| Path | Role | Criticality |
|---|---|---|
| `src/components/products/PookyConfigurator.tsx` | Live configurator UI | **Critical** |
| `src/lib/configuredPrice.ts` | **Verifies basket unit price at checkout** | **Critical** |
| `src/app/products/[id]/page.tsx` | PDP render | Critical |
| `src/components/admin/ProductPookyFields.tsx` | Admin editing | High |
| `src/app/admin/products/{new,[id]/edit}/page.tsx` | Admin forms | High |
| `src/lib/shopify/sync-product{,-full}.ts` | Shopify metafield sync | Medium |
| `src/components/products/ProductSection.tsx`, `src/lib/megaMenu.ts` | Render/nav | Medium |

The application reads these arrays **directly off the product document**. `configuredPrice.ts` re-prices a configured line server-side at checkout, so any change to the shape is checkout-affecting.

### E. Normalisation feasibility

A normalised design would need: a shared Pooky options collection keyed by SKU; per-product references carrying `sortOrder`; a per-product override mechanism for `images` (required by `wallFittings`) and for `name`/`stock` (required by `shades`); and a join or cache on read.

**Behaviour could be preserved in principle**, but `configuredPrice.ts` would need to resolve options through the new structure at checkout time, and that is live pricing code. **Feasibility of exact behavioural equivalence was NOT VERIFIED** — it would need a full read of the configurator and pricing paths.

### F. Storage estimates

Field totals across the whole collection: `shades` 58.46 MB, `bases` 37.70 MB, `wallFittings` 20.12 MB, `pendants` 4.54 MB = **120.82 MB**.

Applying the measured repeated-identity ratios:

| Scenario | Basis | Estimated recoverable |
|---|---|---|
| **Conservative** | `bases` only (95.8% repeated, differs solely by `sortOrder`) | **~36 MB** |
| **Realistic** | `bases` + `wallFittings` (if per-product `images` prove shareable) | **~54 MB** |
| **Maximum theoretical** | All four at measured repeated-identity ratios | **~88 MB** |

*All three assume the sample ratios (150 products of 3,782) hold across the brand. **The sample is 4% of Pooky and was not stratified by product type** — treat as estimated.*

### Conclusion

> **`HEAVILY DUPLICATED SHARED CATALOGUE`** — for `bases` and `wallFittings`
> **`PARTIALLY SHARED / PARTIALLY DUPLICATED`** — for `shades` and `pendants`

The duplication is real and large, but it is *not* inert data: it feeds the live configurator and checkout pricing.

---

## 4. Zero-Usage Product Index Investigation

`$indexStats` window: **2026-09-07 → 2026-09-16 (9 days)**. Counters reset on restart/failover.

| Index | Size | Definition | Code usage (src / scripts) | Import/Sync usage | $indexStats | Risk | Classification |
|---|---:|---|---|---|---:|---|---|
| `name_text_description_text` | **48.19 MB** | text: name, description | **0 `$text` anywhere** | none | 0 | Medium (autoIndex recreate) | **APPEARS REDUNDANT — STAGED TEST REQUIRED** |
| `productCode_1` | 0.63 MB | `{productCode:1}` | 13 / 34 | SKU matching in importers | 0 | High | **LIKELY REQUIRED** |
| `sourceHandle_1` | 0.65 MB | `{sourceHandle:1}` | 1 / 11 | Import upsert key | 0 | High | **LIKELY REQUIRED** |
| `sourceProductId_1` | 0.57 MB | `{sourceProductId:1}` | 1 / 4 | Source matching | 0 | High | **LIKELY REQUIRED** |
| `sourceSku_1` | 0.56 MB | `{sourceSku:1}` | 1 / 4 | Import dedupe (`import-drench.cjs` upserts on it) | 0 | High | **LIKELY REQUIRED** |
| `supplierCategory_1` | 0.55 MB | `{supplierCategory:1}` | 1 / 4 | Supplier imports | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `stockStatus_1` | 0.36 MB | `{stockStatus:1}` | 4 / 20 | Stock sync | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `linxSku_1` | 0.33 MB | `{linxSku:1}` | 5 / 16 | SKU lookup | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `department_1_subCategories_1` | 0.31 MB | compound | 4 / 15 | Listing variant | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `subCategories_1` | 0.29 MB | `{subCategories:1}` | 4 / 15 | Listing variant | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `rangeName_1` | 0.21 MB | `{rangeName:1}` | 2 / 6 | Import grouping | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `categories_1` | 0.20 MB | `{categories:1}` | **31 / 77** | Heavy | 0 | High | **LIKELY REQUIRED** |
| `tradePrice_1` | 0.20 MB | `{tradePrice:1}` | 2 / 5 | Trade pricing | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `subBrand_1` | 0.18 MB | `{subBrand:1}` | **16 / 26** | Brand filtering | 0 | High | **LIKELY REQUIRED** |
| `supplier_1` | 0.17 MB | `{supplier:1}` | — | Supplier ops | 0 | Medium | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |
| `legacyProductCode_1` | 0.17 MB | `{legacyProductCode:1}` | 1 / 3 | Legacy matching | 0 | Low | **POTENTIALLY REQUIRED — MORE OBSERVATION NEEDED** |

### C. Could Mongo use these despite 0 ops?

Yes, and for several it is likely:

- **Compound prefixes** — `department_1_subCategories_1` shares the `department` prefix with `department_1` (40,053 ops). The planner may consistently prefer the smaller single-field index, leaving the compound at 0 without it being useless.
- **Measurement window** — imports are episodic. `sourceSku_1` is the upsert key in `import-drench.cjs`; it read 0 simply because no import ran in those 9 days.
- **Index intersection / covered queries** — not examined. NOT VERIFIED.

### Key correction

**Only the text index has affirmative evidence of redundancy** (no `$text` exists, so it is unreachable). The other 15 have 0 ops but demonstrable code references. Total for those 15 is **~5.4 MB** — small reward for meaningful import-breakage risk.

---

## 5. assetMirrors Investigation

### A. Purpose and lifecycle

A **de-duplication ledger** for mirroring Cloudinary assets into Shopify Files, keyed by source URL, so one asset used by hundreds of products uploads once. Shopify fetches each URL itself via `fileCreate`; bytes never traverse this machine.

| Stage | Code | Behaviour |
|---|---|---|
| Index setup | `mirror-…cjs:92–93` | **Script creates `sourceUrl_1` (unique) and `shopifyUrl_1` on every run** |
| Skip-list read | `:203` | `distinct("sourceUrl", { shopifyFileId: { $nin: [null,""] } })` |
| Upload record | `:260–275` | `bulkWrite` setting `shopifyFileId`, `status` |
| URL harvest | `:124–131` | `bulkWrite` setting `shopifyUrl`, `status` |
| Reporting | `:309–311` | `countDocuments({})`, `countDocuments({shopifyUrl:{$nin:[null,""]}})` |
| Deletion | — | **None. No `deleteOne`/`deleteMany` exists anywhere.** |

### B. Still needed?

**Yes, but only offline.** Zero references in `src/` — no route, action, component or library reads it. Consumers:

```
scripts/mirror-cloudinary-assets-to-shopify.cjs   creates / updates
scripts/fix-ufhs-option-swatch-images.cjs         reads
scripts/fix-usage-icon-images.cjs                 reads
```

It is a **deployment/import-script dependency**, not a live application dependency.

### C. Orphan records

*Measurement was still running when this report was written — see "Pending" below.*

No pruning logic exists, so rows for deleted products or replaced assets persist indefinitely. Growth is driven by **unique assets**, not product count.

### D. Field necessity

| Field | Docs | MB | Assessment |
|---|---|---|---|
| `sourceUrl` | 85,162 | 14.77 | **Required** — the dedupe key |
| `shopifyFileId` | 85,162 | 4.22 | **Required** — filters the skip-list at `:203` |
| `shopifyUrl` | 85,162 | 9.13 | **Required** — consumed by the two `fix-*` scripts |
| `status` | 85,162 | 1.46 | Low value — observed values only |
| `mirroredAt` | 85,162 | 1.30 | Bookkeeping; no query filters on it (NOT VERIFIED) |
| `originalSource` | **62** | 0.01 | Vestigial — present on 0.07% of rows |

### E. Index assessment

| Index | Size | Ops | Assessment |
|---|---|---|---|
| `sourceUrl_1` (UNIQUE) | **16.83 MB** | 0 | **Required.** Enforces the dedupe invariant and backs the `distinct` at `:203`. 0 ops is expected — the script had not run in the window. |
| `shopifyUrl_1` | **7.62 MB** | 0 | **Weakest link.** No query filters on `shopifyUrl` except one reporting `countDocuments` at `:310`. |
| `_id_` | 2.98 MB | 0 | Mandatory. |

**`shopifyUrl_1` is the single best-evidenced index candidate in this report** — 7.62 MB serving one end-of-run count, and **self-healing**: line 93 recreates it on the next run.

### F. Storage opportunity

| Item | Size | Note |
|---|---|---|
| Data (compressed) | 10.38 MB | |
| Indexes | 27.43 MB | 2.64× the compressed data |
| `shopifyUrl_1` | **7.62 MB** | best candidate |
| Orphan rows | *pending* | |

### G. Risk assessment

- **Deleting rows** → the mirror script loses its skip-list and **re-uploads assets already in Shopify**, creating duplicate Shopify Files and consuming API quota. It would not corrupt products.
- **Dropping `sourceUrl_1`** → loses the uniqueness guarantee; concurrent runs could insert duplicate rows, and the `distinct` slows to a collection scan. **Higher risk.**
- **Dropping `shopifyUrl_1`** → one reporting count slows. Recreated automatically on next run. **Lowest risk of anything in this report.**

### Conclusion

> **`ACTIVE BUT POTENTIALLY OVERGROWN`**

Legitimate and well-designed for its purpose, invisible to the live site, never pruned, and carrying an index that costs 2.64× the data it indexes.

---

## 6. sourceAttributes Investigation

### A. Origin

**One importer.** `scripts/import-luxury-flooring.cjs:1116` sets `sourceAttributes: rows`. Lines 1548 and 1572 only log the count.

### B. Structure

Declared at `src/models/Product.ts:1288` as `[SourceAttributeSchema]`, re-added defensively at `:1934` with the comment that a missing path means "silently losing the whole import".

Measured: **5.39 MB across 660 documents — 8,556 B average**, one of the heaviest per-document fields in the catalogue. Luxury Flooring has 606 products, so the populated set is essentially that brand plus a small remainder. **The exact composition of the extra ~54 documents was NOT VERIFIED.**

### C. Live usage

**None found.** Every `src/` reference is a schema declaration (`Product.ts:1288`, `:1896`, `:1934`). No read in any page, component, action, API route or library.

### D. Needed for future sync?

No evidence. Shopify sync does not reference it — it is absent from `buildLinxMetafields` and from the `SyncableProduct` payload mapping. The Luxury Flooring importer **writes** it but does not read it back for change detection.

> **NOT VERIFIED:** whether a future re-import would benefit from comparing against it. Nothing in the current importer does so.

### E. Reconstructable?

**Probably, from the supplier source** — it is captured verbatim at import. It is not derivable from other Mongo fields. **NOT VERIFIED** whether the original source rows are still retrievable.

### F. Storage opportunity

| | |
|---|---|
| Current | **5.39 MB** (1.5% of product storage, ~1.1% of cap) |
| Potentially removable | Up to 5.39 MB |
| Confidence | **Medium-high** that it is unread; **low** on whether it would be wanted for a future re-import |

### Conclusion

> **`LEGACY BUT POTENTIALLY USEFUL`**

Demonstrably unread by the application. Classified below "APPEARS REDUNDANT" only because it is raw supplier data captured at import, and its value for a future re-import has not been ruled out.

---

## 7. Combined Storage Opportunity

| Area | Current | Potential saving | Confidence | Risk | Evidence status |
|---|---:|---:|---|---|---|
| Text index | 48.19 MB | **48.19 MB** | **High** | Medium (autoIndex recreate) | Code-proven: no `$text` exists |
| Pooky `bases` | 37.70 MB | ~36 MB | Medium | **High** (live checkout) | 150-product sample |
| Pooky `wallFittings` | 20.12 MB | ~18 MB | Low-Medium | **High** | Sample; `images` unresolved |
| Pooky `shades` | 58.46 MB | ~30 MB | Low | **High** | Sample; 3 fields vary |
| Pooky `pendants` | 4.54 MB | ~1.7 MB | Low | High | Least duplicated |
| `assetMirrors` `shopifyUrl_1` | 7.62 MB | **7.62 MB** | **High** | **Low** (self-recreating) | Code-traced |
| `assetMirrors` orphan rows | 10.38 MB data | *pending* | — | Medium | Measuring |
| `sourceAttributes` | 5.39 MB | 5.39 MB | Medium-high | Low-Medium | Zero readers found |
| 15 non-text zero-op indexes | 5.38 MB | ≤5.38 MB | **Low** | **High** (imports) | All have code refs |

### Overlap warning

The four Pooky fields total **120.82 MB**; their savings are **not additive with each other** beyond that total, and the three scenarios in §3F are alternative readings of the same 120.82 MB — **not cumulative**.

The text index (48.19 MB) is *index* storage; the Pooky and `sourceAttributes` figures are *document* storage. Both count toward the 512 MB cap, so they do add — but reducing documents also shrinks the indexes over those fields, so combined savings would slightly exceed the simple sum.

| Tier | Total | Composition |
|---|---:|---|
| **Confirmed** | **~55.8 MB** | text index 48.19 + `shopifyUrl_1` 7.62 |
| **Plausible** | **~97 MB** | + `sourceAttributes` 5.39 + Pooky conservative ~36 |
| **Theoretical maximum** | **~150 MB** | + Pooky maximum ~88 + remaining indexes |

**Confirmed tier alone is ~11% of the 512 MB cap, and neither item touches a product document.**

---

## 8. What We Now Know vs What We Still Do Not Know

### CONFIRMED

1. `$text` appears nowhere in `src/` or `scripts/` — verified by repository-wide search.
2. Customer search uses `$regex` (`products.ts:743`); admin search uses `$regex` (`admin.ts:210`).
3. A text index is unreachable without `$text` — the index cannot serve any existing query.
4. The schema declares 8 text fields; the live index covers 2.
5. Search does not query `description`, despite it being half the text index.
6. `bases` SKU `TLMON100BRABRA` appears 48× byte-identical except `sortOrder`.
7. `wallFittings` SKU `WFSWN120BRABRA` appears 78×, identical except `images`.
8. Zero option SKUs carry more than one distinct price.
9. Pooky fields are read by `PookyConfigurator.tsx` and `configuredPrice.ts` (checkout).
10. All 13 non-text zero-op index fields have code references, concentrated in import scripts.
11. `assetMirrors` has zero `src/` references; three scripts use it.
12. The mirror script creates both its indexes itself on every run.
13. No deletion or pruning logic exists for `assetMirrors`.
14. `assetMirrors.originalSource` exists on 62 of 85,162 rows.
15. `sourceAttributes` is written by one importer and read by nothing in `src/`.

### STILL UNVERIFIED

1. **Orphan rate in `assetMirrors`** — measurement was still running.
2. Whether `wallFittings` per-product `images` are genuinely different photographs or the same assets re-ordered. **Determines ~18 MB.**
3. Whether dropping the text index triggers autoIndex recreation on next boot.
4. Why the declared 8-field text index never replaced the 2-field one.
5. Whether any out-of-band tool (shell, Atlas Search, BI connector) uses `$text`.
6. Whether the 15 zero-op indexes are genuinely exercised during a full import cycle.
7. Whether normalising Pooky options could preserve `configuredPrice.ts` behaviour exactly.
8. Whether the Pooky sample (150 of 3,782, unstratified) represents the whole brand.
9. Composition of the ~54 non-Luxury-Flooring documents holding `sourceAttributes`.
10. Whether `sourceAttributes` source rows remain retrievable for re-import.

---

## 9. Safety Assessment

| Area | Safe to change now? | Why not | Evidence required first |
|---|---|---|---|
| **Text index** | **No** | autoIndex may recreate it; out-of-band `$text` not excluded | Set `autoIndex:false` or remove the schema declaration; confirm on staging that no boot recreates it; verify search results identical before/after |
| **Pooky configurator** | **No** | Live configurator + checkout pricing | Full read of `configuredPrice.ts` and `PookyConfigurator.tsx`; stratified sample across all Pooky types; resolve the `images` question; staging clone with checkout regression tests |
| **Zero-op indexes** | **No** | All have code refs; imports were not exercised | `$indexStats` across ≥30 days **including a full import cycle**; `explain()` on importer queries |
| **`assetMirrors` `shopifyUrl_1`** | **Closest to safe, but no** | Still a production index | Confirm no other consumer filters on `shopifyUrl`; confirm line 93 recreates it; time the `:310` count without it |
| **`assetMirrors` rows** | **No** | Deletion causes re-upload and duplicate Shopify Files | Complete orphan analysis; confirm the two `fix-*` scripts are retired |
| **`sourceAttributes`** | **No** | Re-import value unresolved | Confirm supplier source retrievable; export the 660 documents' field to cold storage first |

---

## 10. Final Recommendation — Validation Sequence Only

Ordered by evidence strength and risk, lowest first. **These are validation steps, not implementation steps.**

1. **Finish the `assetMirrors` orphan measurement** — the one incomplete data point in this report.
2. **Resolve the autoIndex question** — read `src/lib/mongodb.ts` connection options and determine whether a dropped text index would be rebuilt on boot. This gates the single largest opportunity (48.19 MB) and requires no production change to answer.
3. **Confirm `shopifyUrl` has no other consumer** — a repository-wide search for queries filtering on it. Low cost, high confidence, 7.62 MB.
4. **Run `$indexStats` again after ≥30 days including a full import cycle** — converts 15 indexes from "0 ops, unknown" to evidence either way.
5. **Resolve the `wallFittings` `images` question** — compare the 78 image arrays for that one SKU. Decides ~18 MB and is pure read.
6. **Stratified Pooky sample** — across product types, not just the 4% already sampled, before trusting the §3F estimates.
7. **Read `configuredPrice.ts` end to end** — establish whether option resolution could survive normalisation.
8. **Establish backup and rollback** — for anything touching product documents, a verified restore path must exist first. Note: **Atlas M0 has no automated backups.**

---

> **NO PRODUCTION DATA, INDEXES, CODE, CONFIGURATION, OR SHOPIFY DATA WAS MODIFIED DURING THIS INVESTIGATION.**

All operations were reads: `find`, `aggregate`, `countDocuments`, `distinct`, `collStats`, `$indexStats`, `listCollections`, `indexes()`, and source-code inspection.

**Pending measurement:** the `assetMirrors` orphan analysis was still executing when this report was written. Its result will be reported separately and §5C, §7 and §8 updated accordingly.
