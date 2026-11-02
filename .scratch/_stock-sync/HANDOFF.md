You are continuing the **brand stock sync** for the LinxLiving repo (`/Users/niazig/Desktop/linxliving/LinxLiving`). Read `.claude/claude.md` first; it is the playbook, and its rules apply. This file is the current state as of 2026-10-30.

## The job (user's exact intent)
For each brand the user names: everything **out of stock on the brand's live supplier site** must be **out of stock on our site (Mongo) and in Shopify**.
- **Do NOT copy live quantities.** In-stock items stay exactly as they are.
- Products gone from live (404) = out of stock. Never delete anything.
- Live products we don't have → report only.

## Hard rules (the user has corrected these before)
1. **Existing fields/settings only.** Never add a new field (no `stockSyncedAt`, no variant `stock` where it doesn't exist) and never change Shopify settings (`inventoryPolicy`, tracking) unless the user explicitly asks.
2. **Out-of-stock only.** No "normalising" in-stock stock values (e.g. 500 → 100).
3. **Backup before every write**, validate (abort on failure), then **verify everything**: re-run the check and expect `dbProductsToUpdate: 0`, `shopifyVariantsToZero: 0`.
4. **Fast, with short updates.** Run anything over a minute in the background (`run_in_background`) and give a one-line status. Never block for long; the user interrupts long foreground calls.
5. **Never get around bot protection.** No faster/parallel cart probing past 429s, no "Are you human?" bypass. If a site blocks, stop and say so.
6. **Finish with links to check:** our page `https://www.linxsquare.co.uk/products/<slug>` plus the live supplier URL, covering fully out / one size out / in stock.
7. Stay in scope. Report problems elsewhere, don't fix them unasked. Don't commit or push unless asked.

## Tools (in `.scratch/_stock-sync/`)
- `shopify-lib.cjs`: Shopify Admin GraphQL helper (client_credentials token from `.env.local`).
- `stock-oos.cjs`: **generic tool for suppliers on Shopify.**
  - Reads `/products.json` for availability. Matches variants by live variant id (`externalId` / `?variant=` in `sourceUrl`), falling back to product handle + SKU.
  - Checks every product missing from the listing individually: 404 → gone; otherwise reads `<handle>.js`.
  - Skips products it can't match reliably.
  - Writes existing fields only.
  ```
  BRAND_SLUG=<slug> ORIGIN=https://<supplier-site> node .scratch/_stock-sync/stock-oos.cjs              # check (read-only)
  MODE=apply BRAND_SLUG=<slug> ORIGIN=https://<supplier-site> node .scratch/_stock-sync/stock-oos.cjs   # backup + write
  # then run the check again = verify (must show 0 to update)
  ```
  Output, backups and logs go to `.scratch/<slug-without-dashes>/` (`oos-check-*.json`, `oos-backup-*.json`).
- `almurad-oos.cjs`: Al Murad only. Applies out-of-stock from an existing snapshot (no site requests). `MODE=check|apply|verify`.
- `aica-*.cjs`: the Aica scripts (reference; Aica-specific ids/paths).

## Brand status
| Brand | Status |
|---|---|
| **Aica Bathrooms** (DB2) | Done. 1,632 variants out of stock in DB2 + Shopify. At the user's request, Shopify was also set to DENY + tracked for all 6,684 variants, and the brand slug was fixed (`undefined` → `aica-bathrooms`). Verified 0 mismatches. |
| **AlunoTec** (DB1) | Nothing to sync. Imported from PDF quotations, no `sourceUrl`, no live shop. Left as is (placeholder stock 25). |
| **Bathdisc** (DB2) | Done. 24 products / 27 variants were 404 on live → out of stock in DB2 + Shopify. Verified 0 left. Bathdisc never marks anything "sold out"; only removals count. |
| **Al Murad** (DB2) | Done from the user's snapshot `.scratch/almurad/stock-live-snapshot.jsonl` (12:42). 114 products (92 fully out, 34 variants), 32 Shopify variants → 0, 5 skipped. Verified 0 left. **Pending user decision:** 89 sold-out variants are still sellable in Shopify (CONTINUE/untracked); offered DENY like Aica. Note: that snapshot's crawler bypasses al-murad's "Are you human?" check, so don't re-run it. |
| **Better Bathrooms** (DB2, `https://www.betterbathrooms.com`, custom ASP.NET site, not Shopify) | Done 2026-10-30. 241 sold-out ("Discontinued") options → out of stock in DB2 + Shopify qty 0 (all BB variants are DENY+tracked); 152 products fully out. Camden mixer skipped (one option's page redirects to a new SKU; all in stock). Tools: scratchpad snapshot → `.scratch/betterbathrooms/stock-2026-10-30.jsonl`, `bb-oos.cjs` (check/apply), `bb-state.cjs` (full before/after dump + diff). Verified 0 left, 0 unplanned changes. |
| **Floors4Trade** (DB1, Shopify supplier floors4trade.co.uk) | Done 2026-10-30 (`f4t-oos.cjs`, verify `f4t-state.cjs`). 153 sold-out options were already available:false; 52 fully-out products → stockStatus out_of_stock (only stock field they have); 52 Shopify variants 1000 → 0 incl. 42 unlinked "Default Title" variants of fully-out DRAFT products. 0 unplanned changes. Live sent one 429 at first — wait 5 min, never push. |
| **Flooring sales** (DB1, WooCommerce flooringsales.co.uk, match `specs.fslId`) | **Blocked**: the site drops every connection from this machine (loads in the user's browser). Script ready: `fs-oos.cjs`. Options: wait, user runs the browser snippet (Store API → JSON), or a supplier stock file. All 2,177 Shopify variants are DENY+tracked. 52 products already say "Out of stock" in stockAvailabilityText but are in_stock. |
| **FAKRO** (DB1) | No live stock source: 132 `specs.sourceUrl` links to cambridgeskylights.co.uk all 404 (CSL dropped FAKRO); fakro.co.uk is catalogue-only; 1,817 have Linx Glass Supabase `specs.sourceId`. Waiting on user to name a source. |
| **Frontline Bathrooms** (DB1, frontlinebathrooms.co.uk) | Done 2026-11-02. Live source = public Stock Checker (/stock-checker/, 783 pages × 4, `fl-snapshot.cjs`); match variant sku = F-code (our "-n" suffix → base code only if the checker description shares a word). "Out of Stock — Due Soon" = sold out; "Special Order" = in stock. 218 options / 167 products (73 fully out) → out of stock in DB1 + Shopify qty 0; 55 products skipped (codes not on the checker, blank, or ambiguous; live pages exist). `fl-oos.cjs`, verify `fl-state.cjs`: 0 unplanned changes. |
| **Noken** (DB1, noken.com = manufacturer catalogue, no stock/price) | Done 2026-11-02, DB only (user: don't touch Shopify drafts — all 9,289 Noken Shopify variants are DRAFT). 41 products (195 options) removed from noken.com (re-confirmed 404) → stock 0 / isOutOfStock / out_of_stock + variants available false, stock 0 (`nk-oos.cjs`, backup `.scratch/noken/oos-backup-2026-11-02T13-51-42-007Z.json`, 0 other changes). 2,057 still listed = untouched. Note: every Noken product is priced £0 → storefront shows "Request a quote" (not "Out of stock"). |
| **MB Decor** (DB1, WooCommerce mbdecor.co.uk, match `specs.mbDecorId`) | **Blocked** like Flooring Sales (same hosting drops automated connections). Nothing written. |
| **The Under Floor Heating** (DB1, Shopify theunderfloorheatingstore.com, match variant externalId) | **Done 2026-11-02** (DNS fixed after the user flushed the cache). 141 options sold out or gone (18 products 404) → out of stock; 62 products updated (41 fully out). Shopify: 141 → 0, all already DENY. Verified 0 left. 19 skipped (live variant ids changed): 17 all in stock; 2 (ProWarm Clearance Cable, Electric Floor Heating Cable) have some options out, which would need matching by option name. Undo: `.scratch/theunderfloorheating/oos-backup-2026-11-02T14-41-43-802Z.json`. |
| **Tile Mountain** (DB2; 6 strays in DB1 untouched; tilemountain.co.uk, JSON-LD per page) | Done 2026-11-02 per user: out on live (239 incl. 37 removed/redirected) → stock 0/out_of_stock; in stock (1,419) → stock 500/in_stock; Shopify all 1,658 → DENY+tracked, qty 0/500 (user asked). `tm-snapshot.cjs`, `tm-sync.cjs`, backup `.scratch/tilemountain/sync-backup-2026-11-02T14-40-17-396Z.json`. Antalya + Chason are duplicate DB pairs sharing one Shopify product (fixed by hand). Re-check: 0 left. |
| **Topps Tiles** (DB1, toppstiles.co.uk behind Cloudflare) | Done 2026-11-02 from 4 API files the user saved in their browser (`.scratch/toppstiles/stock/live/1-4.json`, links in `topps-4-links.html`) + labels from init.js. stock_availability 4910/4911/10919 ("not/unavailable online") = out; 4908/4909/4921 = in. 282 options / 206 products (128 fully out) → out of stock in DB1 + Shopify qty 0; 8 products / 33 options skipped (no code). `tt-oos.cjs`, verify `tt-state.cjs`: 0 unplanned changes. Backup `.scratch/toppstiles/oos-backup-2026-11-02T16-07-17-360Z.json`. |
| **Total Tiles** (DB2, totaltiles.co.uk, Magento) | **Blocked** (Cloudflare 403 for automated reads; GraphQL returns 'forbidden' even in the user's browser; category pages carry no stock). User declined supplier files. Nothing written. |
| **Bathroom4Less** (DB1) | **Done 2026-10-30.** 1,428 products 404 (each checked), 705 all sold out, 182 some options out. DB1: 2,528 products updated; Shopify: 2,215 variants → 0. Verified 0 left, 0 sellable. Undo: `.scratch/bathroom4less/oos-backup-2026-10-30T14-44-28-695Z.json`. **Pending user OK:** 91 in-stock products have variants with no option names (only SKUs), so no picker and only the (now sold-out) first variant sells; fix = copy option names from live `<handle>.js` (adds new fields). |
| **Direct Flooring Online** (DB1) | **Done 2026-10-30.** Their firewall drops our direct requests, so the data was read via the WebFetch tool (Woo Store API `?_fields=slug,is_in_stock`, 588 live products) and each of 57 missing old URLs was checked one by one. 50 products → out of stock in DB1 + Shopify: 7 sold out, 21 removed (410/404), 17 discontinued (redirect to another product), 5 renamed and sold out. 13 renamed but in stock were left alone, and BFCH114 Satin Lacquered (unclear) was left alone. Verified 0 left. Undo: `.scratch/directflooringonline/oos-backup-2026-10-30T15-12-41-680Z.json`. Script: `.scratch/_stock-sync/dfo-oos.cjs`. |
| **Drench** (DB2) | **Done 2026-10-30.** Each parent page's `uniqueProductStockInfo` (all options' InStock) and JSON-LD for single products were read: 5,546 pages, 0 errors. 132 products → out of stock in DB2 (90 fully, including 38 404s; 42 with some options out; 214 variants). Shopify: 244 sold-out variants were untracked, so at the user's OK they were set to DENY + tracked + qty 0 (sold-out ones only). Verified 0 left and 0 sellable. Skipped: 81 (SKU not on page), 8 with no source URL, 4 DB1 strays. Backups: `.scratch/drench/oos-backup-2026-10-30T15-53-08-432Z.json` (original). Script: `.scratch/_stock-sync/drench-oos.cjs` (`MODE=crawl|check|apply`, `FIX_SELLABLE=1`). |
| **Tiles Porcelain / Tap Warehouse / Spectra / Ca'Pietra / Porcious / Pooky / PORCELANOSA / Otto Tiles / Luxury Flooring** | Done 2026-11-02 in the main chat (backups in each `.scratch/<brand>/`). Tiles Porcelain: 3 sold-out Shopify variants are still untracked, awaiting the user's OK. Ca'Pietra works only via `www.capietra.com`. |
| **Walls and Floors** (DB2, Magento, GraphQL off) | **Done 2026-11-02.** Product and option pages read (1,519, 0 errors); JSON-LD OutOfStock is shown to customers as "More Stock due <date>". 110 products updated (91 fully out incl. 3 404s; 19 with 25 options out). Shopify: 25 → 0, plus 88 untracked sold-out variants set to DENY+tracked+0 (user OK). 51 skipped (option page unreadable / no stock info). Undo: `.scratch/wallsandfloors/oos-backup-2026-11-02T15-21-16-712Z.json`. Script: `.scratch/_stock-sync/wallsandfloors-oos.cjs`. Also 2026-11-02: Toasty all in stock (no change); UK Bifold 18 discontinued Smart Systems products → out; Topps Tiles & Total Tiles blocked by Cloudflare (left, user said leave Topps). |

## Open items for the user (not done)
1. **Deploy the storefront code fixes.** They're uncommitted on branch `gul/visuilizer`:
   - `src/components/products/ProductSection.tsx`: add-to-basket is blocked when the selected variant is sold out.
   - `src/components/products/ProductVariantPicker.tsx` and `src/components/ui/VariantSelect.tsx`: sold-out options can't be chosen.
   - `src/lib/shopify/inbound.ts` and `src/lib/shopify/pull-products.ts`: the admin auto-pull now uses `totalInventory` instead of the first variant's quantity.
2. **Multi-axis picker gap** (offered, not done). Options are checked one axis at a time, e.g. Al Murad "Quarry Wall & Floor Tile": 60x120 + Grey is sold out, and 60x120 + Red doesn't exist. The fix: enable the existing `onlyRealCombinations` + `settleSelection` (today Topps-only, `ProductSection.tsx` ~line 1888) for all brands, plus availability-aware `sellable()`.
3. Shopify DENY for Al Murad's 89 sellable sold-out variants: waiting on the user's OK.
4. A scheduled re-check per brand: offered, not set up.

## Watch out for
- **Admin auto-pull.** While an `/admin` tab is open, the ~8 most recently updated Shopify products are pulled back into Mongo every 90 s. Write Shopify with single-variant products last.
- Don't change `updatedAt` (the auto-push keys on it). Use the raw Mongo driver with targeted `$set` + `arrayFilters`, and never rewrite the `variants` array.
- **Another process changed Shopify settings mid-run once.** Re-read state right before writing.
- Pages are cached, so a hard refresh may be needed. `revalidateProductCaches()` doesn't work from scripts.
- **Mongo M0 clusters:** `maxPoolSize` ≤ 3, set DNS servers from `MONGODB_DNS_SERVERS`, close clients.
