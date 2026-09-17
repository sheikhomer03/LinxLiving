# THIRD READ-ONLY INVESTIGATION — FINAL VALIDATION

> READ-ONLY INVESTIGATION — NO CHANGES MADE

**Date:** 2026-09-16 · Evidence labels: `CONFIRMED` · `LIKELY` · `ESTIMATED` · `THEORETICAL` · `NOT VERIFIED`

---

# 1. Executive Summary

Three questions are now closed, one is closed in the opposite direction from what was hoped, and one could not be measured.

**The text index (48.19 MB) is unreachable by application code — but it cannot simply be dropped.** `connectDB()` never sets `autoIndex`, so Mongoose's default `true` applies and would attempt to recreate it from the schema declaration. The schema declaration must be removed first. `CONFIRMED`.

**`assetMirrors.shopifyUrl_1` (7.62 MB) is the only candidate with no functional dependency at all.** Every `shopifyUrl` reference in `src/` turns out to be `shopifyImages.shopifyUrl` on the *Product* document — an entirely different field. The one real query uses it as a `$nin` residual, which cannot use an index. `CONFIRMED`.

**Pooky duplication is far larger than the 150-product sample showed — and far less safe to act on.** Full-brand stratification found reuse ratios of **463×** (`bases` in lampshades), **451×** (`wallFittings`), and **95×** (`shades` in table-lamps), against the 3–24× the sample suggested. But Investigation 6 found that `configuredPrice.ts` resolves options **by array position, not SKU**, at checkout. Array ordering is a live pricing contract.

**The `wallFittings` image saving is gone.** SKU `WFSWN120BRABRA` appears in 761 products with **758 genuinely distinct image URLs** — not re-ordering, not near-duplicates. The ~18 MB estimate in Report 2 was wrong.

**`sourceAttributes` is now exactly characterised:** 606 documents, **100% Luxury Flooring**, 5.39 MB, one writer, zero readers.

**Still unmeasured:** the `assetMirrors` orphan rate. The first attempt returned "99% orphaned" but was invalid — it scanned only `images`/`shopifyImages`/`schematicImage` and missed the option arrays where Pooky's shade and base images actually live. The corrected scan was not run.

**Confirmed low-risk total: ~55.8 MB** (text index 48.19 + `shopifyUrl_1` 7.62), neither touching a product document — about **11% of the 512 MB ceiling**.

---

# 2. Text Index — Final Verdict

**Size:** 48.19 MB · 54.6% of all index storage · 9.4% of the 512 MB cap.

### Application usage — `CONFIRMED`

| Question | Finding | Evidence |
|---|---|---|
| `$text` anywhere? | **Zero occurrences** | repo-wide search of `src/`, `scripts/` (.ts/.tsx/.cjs/.mjs/.js/.json) |
| `textScore` / `$meta`? | **Zero occurrences** | same search |
| Customer search | `$regex` + `$options:"i"` | `src/app/actions/products.ts:743` in `getPublicProducts` (`:407`) |
| Admin search | `$regex` + `$options:"i"` | `src/app/actions/admin.ts:210` |
| Fields searched | name, sku, productCode, barcode, category, subCategory, department, `specs.size` | `products.ts:751–770` |

A MongoDB text index is addressable **only** via `$text`. With no `$text` in the codebase, no application query can select it. `CONFIRMED`.

Note: search does **not** query `description`, which is half the live index.

### Mongoose behaviour — `CONFIRMED`

`src/lib/mongodb.ts` — `connectDB()` builds options as:

```ts
const opts: mongoose.ConnectOptions = { bufferCommands: false };
```

- `autoIndex` / `autoCreate`: **never set anywhere in the repository** → Mongoose default `autoIndex: true` applies
- `syncIndexes` / `createIndexes` / `ensureIndexes` / `.init()`: **no calls anywhere**
- `createIndex`: appears **only** on `assetMirrors` (`mirror-cloudinary-assets-to-shopify.cjs:92–93`, `fix-ufhs-option-swatch-images.cjs:149`) — never on `products`
- Deployment: `vercel.json` contains only `{"regions":["bom1"]}`; no `postinstall`/`prestart` index step in `package.json`

**Consequence:** dropping the index without changing `src/models/Product.ts:1347–1356` would see Mongoose attempt recreation on next Product model use.

### Schema / live mismatch

Declared (`Product.ts:1347–1356`): `name, description, linxSku, supplierSku, productCode, legacyProductCode, keywords, synonyms` — **8 fields**.
Live: `name_text_description_text` — **2 fields**.

**Mechanism — `LIKELY`:** MongoDB permits one text index per collection. The 2-field index already exists, so the 8-field creation conflicts (`IndexOptionsConflict` / `IndexKeySpecsConflict`) and fails on each startup. Mongoose surfaces index errors on the model's `index` event; with no handler registered they are swallowed.

> `NOT VERIFIED`: the actual error was not observed. Confirming requires attaching an index-event listener or reading server logs — neither was done.

### Out-of-band usage

No Atlas Search config, BI connector config, or mongosh scripts found in the repository.

> **OUT-OF-BAND USAGE NOT VERIFIABLE FROM REPOSITORY**

### Staging validation required

1. Set `autoIndex: false` (or remove the declaration) in a staging clone; restart; confirm the index is not recreated.
2. Drop the index in staging; run a search regression comparing result sets and ordering before/after.
3. Check Atlas UI for Atlas Search indexes and any BI connector.
4. Review Atlas slow-query/profiler output for `$text` from non-application sources.

### Status

**`WAIT`** — evidence of non-use is strong and direct; the autoIndex recreation path and out-of-band uncertainty are unresolved.

---

# 3. assetMirrors — Final Verdict

**85,162 documents · 34.14 MB logical · 10.38 MB compressed · 27.43 MB indexes** (2.64× the compressed data).

### Orphan analysis — `NOT VERIFIED`

A first measurement returned **84,300 / 85,162 (99.0%) unmatched**. **That result is invalid and must not be used.** It scanned only `images`, `shopifyImages.sourceUrl` and `schematicImage`. The unmatched samples were all Pooky option URLs (`.../products/pooky/25cm-empire-shade-in-…`), which live inside the `shades`/`bases`/`wallFittings`/`pendants` arrays — never scanned. The mirror script's own header states the case directly: *"A shade image used by four hundred products is one row and one upload."*

A corrected scan (recursive walk over all 30+ image-bearing fields) was written but **not run**.

| Bucket | Count |
|---|---|
| Definitely active | `NOT VERIFIED` |
| Probably historical | `NOT VERIFIED` |
| Definitely orphaned | `NOT VERIFIED` |
| Cannot determine | all 85,162 pending the corrected scan |

**Status distribution (`CONFIRMED`):** `READY` = 84,995 · `UPLOADED` = 167.

### `shopifyUrl_1` — `CONFIRMED` REDUNDANT

| Reference | Location | Uses the index? |
|---|---|---|
| Index creation | `mirror-…cjs:93` | creates it |
| Write | `mirror-…cjs:126` `$set: {shopifyUrl}` | no |
| Write | `mirror-…cjs:267` `$set: {status}` | no |
| Report count | `mirror-…cjs:310` `countDocuments({shopifyUrl:{$nin:[null,""]}})` | **`$nin` — cannot use an index efficiently** |
| Read | `fix-usage-icon-images.cjs:80` `find({sourceUrl:{$in:[…]}, shopifyUrl:{$nin:["",null]}})` | **driven by `sourceUrl_1`; `shopifyUrl` is a residual filter** |
| Other fix script | `fix-ufhs-…cjs:149` | creates **only** `sourceUrl_1` |

Every `shopifyUrl` reference in `src/` (`products.ts:2081`, `productImage.ts:446–508`, `moreFromProducts.ts:14`, `sync-media.ts:191`, `Product.ts:80`) refers to **`shopifyImages.shopifyUrl` on the Product document** — a different field in a different collection.

**Self-healing:** `mirror-…cjs:93` recreates the index on every run.

**Conclusion: `REDUNDANT`** — 7.62 MB, no query uses it as an access path, recreated automatically if needed.

### Deletion / re-upload risk

- Deleting rows → the skip-list at `:203` (`distinct("sourceUrl", {shopifyFileId:{$nin:[null,""]}})`) loses entries → **assets already in Shopify are uploaded again**, creating duplicate Shopify Files and consuming API quota. Products are not corrupted.
- Dropping `sourceUrl_1` → loses the uniqueness invariant; `distinct` degrades to a collection scan. **Higher risk.**
- Dropping `shopifyUrl_1` → one reporting count slows. **Lowest risk in this report.**

### Status

**`ACTIVE BUT POTENTIALLY OVERGROWN`** — never pruned; orphan rate unknown pending a valid scan.

---

# 4. Pooky — Final Duplication Analysis

## Stratified results — full brand, 3,782 products (`CONFIRMED`)

Strata: lampshades 2,132 · table-lamps 572 · wall-lights 517 · ceiling-lights 354 · sockets-and-switches 138 · bathroom 42 · mirror 15 · rechargeable-lighting 12.

### lampshades (2,132)

| Field | Products | Slots | Distinct SKU | Reuse | Repeated | MB |
|---|---|---|---|---|---|---|
| **bases** | 1,922 | **135,736** | **293** | **463.3×** | **99.8%** | **34.70** |
| **wallFittings** | 795 | **57,279** | **127** | **451.0×** | **99.8%** | **18.94** |
| shades | 1,795 | 2,498 | 1,795 | 1.4× | 28.1% | 2.10 |
| pendants | 337 | 337 | 337 | 1.0× | 0.0% | 0.29 |

### table-lamps (572)

| Field | Products | Slots | Distinct SKU | Reuse | Repeated | MB |
|---|---|---|---|---|---|---|
| **shades** | 360 | **134,827** | **1,413** | **95.4×** | **99.0%** | **39.09** |
| bases | 364 | 762 | 365 | 2.1× | 52.1% | 0.69 |
| pendants | 5 | 285 | 161 | 1.8× | 43.5% | 0.08 |

### wall-lights (517)

| Field | Products | Slots | Distinct SKU | Reuse | Repeated | MB |
|---|---|---|---|---|---|---|
| **shades** | 108 | **39,369** | **465** | **84.7×** | **98.8%** | **13.78** |
| pendants | 66 | 9,315 | 221 | 42.1× | 97.6% | 3.24 |
| wallFittings | 130 | 399 | 131 | 3.0× | 67.2% | 0.12 |

### ceiling-lights (354)

| Field | Products | Slots | Distinct SKU | Reuse | Repeated | MB |
|---|---|---|---|---|---|---|
| pendants | 19 | 1,791 | 186 | 9.6× | 89.6% | 0.65 |
| shades | 2 | 886 | 443 | 2.0× | 50.0% | 0.32 |
| wallFittings | 19 | 159 | 27 | 5.9× | 83.0% | 0.04 |

**The 150-product sample materially understated this.** It reported reuse of 3–24×; the full brand shows up to **463×**. `CONFIRMED`.

## What actually varies per SKU

| Field / stratum | price | stock | name | handle | images | sortOrder |
|---|---|---|---|---|---|---|
| bases / lampshades (293 SKUs) | **0** | 78 | 19 | **0** | 21 | **285** |
| wallFittings / lampshades (127) | 1 | 44 | 3 | **0** | **127** | 123 |
| shades / table-lamps (1,413) | **0** | 133 | 35 | **0** | 36 | **1,396** |
| shades / wall-lights (465) | **0** | 53 | 2 | **0** | **465** | 449 |

**Two consistent patterns — `CONFIRMED`:**
1. **`price` and `handle` essentially never vary per SKU.** Pricing is global to the option.
2. **`sortOrder` varies for almost every SKU.** This is the per-product data — and per Investigation 6 it is exactly what the checkout's positional lookup depends on.

## Image analysis — `CONFIRMED`

SKU `WFSWN120BRABRA`, full-brand scan:

| | |
|---|---|
| Products carrying it | **761** |
| Total image references | 761 (1 each) |
| **Distinct image URLs** | **758** |
| Distinct ordered sets | 758 |
| **Distinct sets ignoring order** | **758** |
| Repeated references | 0.4% |
| Image bytes for this SKU | 155.8 KB |

Ordered and order-insensitive counts are identical, so **ordering is not the difference — the URLs are genuinely different**. Report 2's estimate of ~18 MB recoverable from `wallFittings` images is **withdrawn**.

> `NOT VERIFIED`: why one wall-fitting SKU carries 758 distinct images. A plausible explanation is composite photography showing the fitting with each product's shade, but this was not confirmed.

## Storage estimates

Field totals: shades 58.46 · bases 37.70 · wallFittings 20.12 · pendants 4.54 = **120.82 MB**.

Element sizes measured: bases ~261 B, wallFittings ~373 B, shades ~785 B.

| Scenario | Basis | Estimate | Label |
|---|---|---|---|
| **Conservative** | Share identity+price only (name, handle, sku, price); keep per-product `sortOrder` + `images` inline | **~45 MB** | `ESTIMATED` |
| **Realistic** | Above, plus sharing `images` only where identical across products | **~60 MB** | `ESTIMATED` |
| **Maximum theoretical** | Store each option once; per-product rows hold only `{ref, sortOrder}` | **~95 MB** | `THEORETICAL` |

Maximum is **not achievable for `wallFittings` or `shades` in wall-lights**, where images are genuinely per-product (127/127 and 465/465 SKUs differ).

## Conclusion

> **`HEAVILY DUPLICATED SHARED CATALOGUE`** for `bases` (lampshades) and `shades` (table-lamps, wall-lights) — reuse 95×–463×, price never varying.
> **`PARTIALLY SHARED`** for `wallFittings` — identity shared, images genuinely per-product.
> **`MOSTLY PRODUCT-SPECIFIC`** for `pendants` in lampshades (1.0× reuse).

---

# 5. Pooky Checkout Dependency Analysis

## Call chain

```
Cart / configurator UI
  └─ PookyConfigurator.tsx            builds a selection
       └─ { baseIndex, shadeIndex, pendantIndex,
            wallFittingIndex, shadeTab, claimedUnitPrice }
            │  POST
            ▼
  /api/checkout/shopify/route.ts       verifyConfiguredUnitPrice(product, sel)
       └─ configuredPrice.ts:181
            └─ case "pooky"  →  pookyComponentTotal(product, sel.pooky)   :145
                 └─ pick(product.wallFittings, sel.wallFittingIndex)
                    pick(product.bases,        sel.baseIndex)
                    pick(product.shades|pendants, sel.shadeIndex|pendantIndex)
                       └─ const item = arr[index];   ← POSITIONAL
                          return Number(item.price) || 0
            floor   = components
            allowed = round2(floor * (1 - MAX_LEGITIMATE_DISCOUNT) - SLACK)
            if (claimed < allowed) → REJECT
            else                   → charge claimed
```

## Findings

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Where does option data come from? | The **embedded arrays on the Product document** | `configuredPrice.ts:154–159` |
| 2 | How is the selection represented? | **Integer array indices**, not SKUs | `ConfiguredSelection.pooky` (`:31`) |
| 3 | How is price obtained? | `arr[index].price` | `:150–152` |
| 4 | From the embedded arrays? | **Yes** | `:154` |
| 5 | **Is SKU sufficient to resolve an option?** | **No — SKU is never read at checkout** | `pick()` uses position only |
| 6 | Product ID + SKU both required? | Neither; **product document + integer index** | `:145` |
| 7 | Do images/name/sortOrder affect checkout? | `images`/`name` no. **`sortOrder` affects it indirectly — it determines array order, which determines what `arr[index]` resolves to** | `LIKELY` |
| 8 | Does the server validate independently? | Partially — it computes a **floor** and rejects only if `claimed` falls below it. It does not recompute the exact price | `:264–272` |
| 9 | What breaks under normalisation? | **Any change to array order or membership mis-resolves `arr[index]`**, producing a wrong floor — rejecting valid orders or under-charging | `CONFIRMED` |
| 10 | Could normalisation preserve behaviour? | Only if resolution order is reproduced **exactly**, per product | `ESTIMATED` |

## The critical constraint

Checkout's contract with the client is **positional**. The client sends "base #7"; the server prices `product.bases[7]`. The 463× duplicated `bases` array is not redundant storage from the checkout's point of view — its **length and ordering are the addressing scheme**.

Normalisation would have to either materialise the same ordered array at read time before pricing, or migrate the client contract from indices to SKUs — the latter being a breaking change affecting any basket in flight.

---

# 6. sourceAttributes — Final Verdict

| | |
|---|---|
| Documents with non-empty value | **606 — 100% Luxury Flooring** `CONFIRMED` |
| Storage | 5.39 MB (~8,556 B/doc) |
| Writers | **One:** `scripts/import-luxury-flooring.cjs:1116` (`sourceAttributes: rows`) |
| Readers in `src/` | **None.** Only schema declarations: `Product.ts:1288`, `:1896`, `:1934` |
| Shopify sync | Absent from `buildLinxMetafields` and the `SyncableProduct` payload |
| Logging only | `import-luxury-flooring.cjs:1548`, `:1572` (counts) |

Report 2's figure of 660 documents counted empty arrays; **606 hold data**.

- **Change detection?** No evidence the importer reads it back. `NOT VERIFIED` that no future import would want it.
- **Reconstructable?** From the supplier source, since it is captured verbatim at import. Not derivable from other Mongo fields. `NOT VERIFIED` whether the source rows remain retrievable.

**Classification: `LEGACY BUT POTENTIALLY USEFUL`** — demonstrably unread; held below "redundant" only because it is raw supplier data whose re-import value is unproven.

---

# 7. Other Indexes

Unchanged from Report 2 and **not re-litigated**: all 13 non-text zero-operation index fields carry real code references, concentrated in import scripts that did not run during the 9-day `$indexStats` window (`categories` 31 src / 77 scripts; `productCode` 13/34; `subBrand` 16/26; `sourceSku` is the upsert key in `import-drench.cjs`).

Combined they total **~5.38 MB** — small reward against real import-breakage risk.

**No index should be removed on `$indexStats` evidence alone.** Only the text index carries affirmative proof of unreachability, and that proof comes from the absence of `$text`, not from the counter.

---

# 8. Updated Storage Model

**Baseline (measured 2026-09-16):** dataSize 392.71 MB + indexSize 88.34 MB = **481.05 MB of 512 MB (94%)**.

**Assumptions — all `ESTIMATED`:** ~13,592 B average per product document and ~2,130 B of index per product, both derived from current measurements. The average is skewed by Pooky (43,318 B); a catalogue of Drench-shaped (13,938 B) or RAK-shaped (2,241 B) products would grow differently. Non-product collections held flat. No historical time-series exists to validate the curve.

### Scenario A — No changes

| Products | Data | Index | Total | vs 512 MB |
|---|---|---|---|---|
| 27,594 (now) | 392.7 MB | 88.3 MB | **481.1 MB** | **94%** |
| 30,000 | 424 MB | 93 MB | **517 MB** | **101% — exceeded** |
| 40,000 | 554 MB | 114 MB | **668 MB** | 130% |
| 50,000 | 684 MB | 136 MB | **820 MB** | 160% |
| 75,000 | 1.01 GB | 189 MB | **1.19 GB** | 233% |
| 100,000 | 1.33 GB | 243 MB | **1.57 GB** | 307% |

**The cap is breached at roughly 30,000 products — about 2,400 more than today.** `ESTIMATED`

### Scenario B — High-confidence, low-risk only

Text index 48.19 MB + `shopifyUrl_1` 7.62 MB = **55.81 MB** recovered → **425.2 MB (83%)**.

| Products | Total | vs 512 MB |
|---|---|---|
| 30,000 | 461 MB | 90% |
| 35,000 | 526 MB | **103% — exceeded** |

**Buys roughly 7,000 products of headroom, not a change in trajectory.** `ESTIMATED`

### Scenario C — Pooky normalisation (theoretical, additive to B)

| Variant | Recovered | Total after B+C | vs cap |
|---|---|---|---|
| Conservative ~45 MB | 100.8 MB | 380 MB | 74% |
| Realistic ~60 MB | 115.8 MB | 365 MB | 71% |
| Maximum ~95 MB | 150.8 MB | 330 MB | 64% |

At the realistic figure the cap is reached near **~38,000 products**. `THEORETICAL` — not safe to implement (§5).

**None of the three scenarios changes the growth rate.** They shift the breach point by roughly 2,400 → 7,000 → 10,000 products.

---

# 9. Storage Optimization Safety Matrix

| Candidate | Est. Saving | Evidence | Production Risk | Reversibility | Confidence | Safe to Implement Now? |
|---|---:|---|---|---|---|---|
| Product text index | 48.19 MB | `CONFIRMED` no `$text`; `CONFIRMED` autoIndex unset | Medium — recreation on restart; search regression | Yes (rebuildable, slow on M0) | High | **NOT YET VERIFIED** |
| `assetMirrors.shopifyUrl_1` | 7.62 MB | `CONFIRMED` no access-path use; script recreates it | Low | Yes (auto) | High | **NOT YET VERIFIED** |
| `assetMirrors` orphan pruning | Unknown | `NOT VERIFIED` — first scan invalid | Medium — re-upload, duplicate Shopify Files | No (rows unrecoverable) | None | **NO** |
| `sourceAttributes` | 5.39 MB | `CONFIRMED` 606 docs, one writer, zero readers | Low–Medium | Only via re-import | Medium-high | **NOT YET VERIFIED** |
| Pooky `bases` normalisation | ~34.7 MB | `CONFIRMED` 463× reuse, price never varies | **High** — positional checkout contract | Yes with backup | Medium | **NO** |
| Pooky `wallFittings` normalisation | ~15 MB | `CONFIRMED` 451× identity reuse; images genuinely per-product | **High** | Yes with backup | Low–Medium | **NO** |
| Pooky `shades` normalisation | ~39 MB | `CONFIRMED` 95× reuse (table-lamps) | **High** | Yes with backup | Medium | **NO** |
| Pooky `pendants` normalisation | ~1.5 MB | `CONFIRMED` 1.0–42× depending on stratum | High, low reward | Yes | Low | **NO** |
| 15 other zero-op indexes | ~5.38 MB | All have code references | **High** — import breakage | Yes | Low | **NO** |
| `assetMirrors.originalSource` | ~0.01 MB | 62 of 85,162 rows | Low | No | Medium | **NO** — negligible |

---

# 10. What Is Actually Proven

1. `$text`, `textScore`, `$meta` appear **nowhere** in `src/` or `scripts/`.
2. Customer search uses `$regex` (`products.ts:743`); admin search uses `$regex` (`admin.ts:210`).
3. A text index is unreachable without `$text`.
4. `connectDB()` sets only `{bufferCommands:false}`; `autoIndex`/`autoCreate` are **never set** repo-wide.
5. No `syncIndexes`/`createIndexes`/`ensureIndexes`/`.init()` calls exist.
6. `createIndex` is called only on `assetMirrors`, never on `products`.
7. No deployment-time index creation exists.
8. Every `shopifyUrl` reference in `src/` is `shopifyImages.shopifyUrl` on Product — a different field.
9. `assetMirrors.shopifyUrl` is used only as `$nin` residuals and one reporting count.
10. `mirror-…cjs:93` recreates `shopifyUrl_1` on every run.
11. `configuredPrice.ts:145` resolves Pooky options **by array position, not SKU**.
12. Checkout rejects a line when `claimed < floor × (1−MAX_LEGITIMATE_DISCOUNT) − SLACK`.
13. Pooky reuse: `bases` 463×, `wallFittings` 451× (lampshades); `shades` 95× (table-lamps), 84.7× (wall-lights).
14. `price` and `handle` essentially never vary per option SKU; `sortOrder` varies for nearly all.
15. `WFSWN120BRABRA` appears in 761 products with 758 distinct image URLs — identical counts ordered and unordered.
16. `sourceAttributes`: exactly 606 documents, all Luxury Flooring, one writer, zero `src/` readers.
17. `assetMirrors` status values: `READY` 84,995, `UPLOADED` 167.
18. The first orphan measurement was methodologically invalid.

---

# 11. What Is Still Unverified

1. **`assetMirrors` orphan rate** — corrected scan not run.
2. Whether the Mongoose index-conflict error actually occurs (mechanism is `LIKELY`, unobserved).
3. Whether dropping the text index triggers recreation in practice — inferred from config, not tested.
4. **OUT-OF-BAND USAGE NOT VERIFIABLE FROM REPOSITORY** — Atlas Search, BI connector, mongosh, manual queries.
5. Why one wall-fitting SKU carries 758 distinct images.
6. Whether `sortOrder` is definitively the array-ordering source for the positional contract.
7. Whether the 15 zero-op indexes are exercised during a full import cycle.
8. Whether `sourceAttributes` source rows remain retrievable for re-import.
9. Whether any in-flight basket format could survive an ordering change.
10. Whether non-product collections reference `assetMirrors.sourceUrl`.
11. Growth curve shape — §8 is linear extrapolation with no historical data.

---

# 12. Exact Prerequisites Before Implementation

### Text index
- [ ] Verified backup / export of the index definition
- [ ] Staging clone; remove the declaration at `Product.ts:1347–1356` **or** set `autoIndex:false`
- [ ] Restart staging; confirm no recreation
- [ ] Search regression: identical result sets and ordering across a representative query set
- [ ] Atlas UI check for Atlas Search indexes and BI connector
- [ ] Atlas profiler review for `$text` from non-application sources
- [ ] Documented rollback (recreate index; note rebuild time on M0)

### `assetMirrors.shopifyUrl_1`
- [ ] Confirm no consumer outside `src/`+`scripts/`
- [ ] Staging: drop, run mirror script, confirm `:93` recreates it
- [ ] Time `countDocuments` at `:310` without it
- [ ] Rollback: single `createIndex`

### `assetMirrors` pruning
- [ ] **Run the corrected orphan scan first** — no pruning decision is possible without it
- [ ] Check non-product collections for `sourceUrl` references
- [ ] Export all rows before any deletion
- [ ] Confirm the two `fix-*` scripts are retired or unaffected
- [ ] Quantify the Shopify re-upload cost of a wrong deletion

### `sourceAttributes`
- [ ] Export all 606 documents' field to cold storage
- [ ] Confirm the Luxury Flooring supplier source is retrievable
- [ ] Confirm the importer does not read it for change detection
- [ ] Rollback: restore from export

### Pooky normalisation
- [ ] Full read of `PookyConfigurator.tsx` to establish how indices are generated
- [ ] Determine definitively whether `sortOrder` drives array order
- [ ] Decide index-based vs SKU-based client contract — **breaking change if altered**
- [ ] Staging clone with full checkout regression across every stratum
- [ ] Test in-flight baskets created before the change
- [ ] Verify Shopify metafield sync still round-trips
- [ ] Full backup with verified restore — **note Atlas M0 has no automated backups**

---

# 13. Recommended Order of Future Work

Ordered by evidence strength and risk, not business value.

1. **Run the corrected `assetMirrors` orphan scan** — read-only; closes the one open measurement.
2. **Check Atlas UI for Atlas Search / BI connector** — read-only; closes the largest remaining unknown on the 48.19 MB candidate.
3. **Confirm `shopifyUrl_1` has no external consumer** — read-only.
4. **Re-run `$indexStats` after ≥30 days including a full import cycle** — converts 15 indexes from unknown to evidenced.
5. **Staging validation of the text index** (autoIndex behaviour, then search regression).
6. **Staging validation of `shopifyUrl_1`.**
7. **Export `sourceAttributes` to cold storage** and confirm supplier source retrievability.
8. **Read `PookyConfigurator.tsx` end-to-end** — establishes whether the positional contract can be preserved at all.
9. **Only then** model a Pooky normalisation design, and only against a staging clone with checkout regression.

---

# 14. Final Go / No-Go Status

| Candidate | Status | Reason |
|---|---|---|
| Product text index | **WAIT** | Non-use proven; autoIndex recreation and out-of-band usage unresolved |
| `assetMirrors.shopifyUrl_1` | **WAIT** | Strongest evidence of any candidate; needs only staging confirmation of auto-recreation |
| `assetMirrors` orphan pruning | **WAIT** | Orphan rate unmeasured; the one figure obtained was invalid |
| `sourceAttributes` | **WAIT** | Unread confirmed; re-import value and source retrievability unproven |
| Pooky `bases` normalisation | **NO-GO** *(current evidence)* | Positional checkout contract; would mis-price in-flight baskets |
| Pooky `wallFittings` normalisation | **NO-GO** | Same, plus images genuinely per-product — saving smaller than estimated |
| Pooky `shades` normalisation | **NO-GO** | Same positional contract |
| Pooky `pendants` normalisation | **NO-GO** | High risk, ~1.5 MB reward |
| 15 other zero-op indexes | **NO-GO** | All carry code references; ~5.38 MB against import breakage |

**No candidate is currently GO.** The two closest — the text index and `shopifyUrl_1` — need staging confirmation only, not further investigation.

**A note on scope:** §8 shows the cap is breached at roughly 30,000 products even with every safe optimisation applied. That is a capacity question, not an optimisation one, and no finding here changes it. The investigation was explicitly not asked to recommend architectural change, and nothing discovered makes the current architecture technically impossible — but the storage model should be read alongside any decision about future product volume.

---

> NO PRODUCTION DATA, INDEXES, CODE, CONFIGURATION, SHOPIFY DATA, OR ARCHITECTURE WERE MODIFIED.

All operations were reads: `find`, `aggregate`, `countDocuments`, `distinct`, `collStats`, `listCollections`, `indexes()`, and source-code inspection. The corrected `assetMirrors` orphan scan was written but **not executed**; §3 and §11 record it as unmeasured rather than carrying the invalid 99% figure.
