# Playbook: make a brand's out-of-stock match its live supplier site (DB + Shopify)

Use this when the user asks to sync a brand's stock with the brand's **live website**. The user names the brand. You work out everything else.

**What the user wants:** every product or variant that is **sold out on the live site** must be **out of stock on our site and in Shopify**.
- **Don't copy live quantities.** In-stock quantities stay as they are. Only sold out → 0 / out of stock.
- If something on our side is no longer on the live site, treat it as sold out. Never delete it.

Proven on Aica Bathrooms, 2026-10-30. Reference scripts are in `.scratch/_stock-sync/`; they have Aica ids and paths hard-coded, so adapt them.

---

## 0. How to work with this user
- **Fast and short.** Use a few live requests, bulk reads and bulk writes. Run anything over a minute in the background and post a one-line status. Don't sit blocked.
- **Plain English.** Give numbers and 3–5 concrete examples. End with **sample product links** the user can check: our URL (`https://www.linxsquare.co.uk/products/<slug>`) and the live URL.
- **Write only existing fields and settings.** Never add a new field, change a Shopify setting, or touch price, text, images, categories or slugs unless the user asks. Before writing, say exactly which existing fields will change.
- **"Do it with proper checks" means approval to write.** Every write still comes after a backup and an automatic validation that aborts on failure.
- **One brand per run.** Report problems outside the task; don't fix them unasked. Temp data goes in `.scratch/<brand>/`, scripts in your scratchpad. Don't commit unless asked. Never print `.env.local` secrets.

---

## 1. Repo facts

**Databases.** DB1 = `MONGODB_URI`, DB2 = `MONGODB_URL2`.
- Both are Atlas M0 (500-connection cap): keep `maxPoolSize` ≤ 3 and close clients.
- Call `dns.setServers(MONGODB_DNS_SERVERS)` first; SRV lookups time out on this machine.
- `brands` always live in **DB1**. `brand.dataCluster`: `"secondary"` means products are in DB2; `"primary"` or absent means DB1.
- Products link to their brand by `product.brand` (ObjectId). Count the other cluster too, and report any strays.

**Stock fields** (`src/models/Product.ts`)
- **Product:** `stock`, `isOutOfStock`, `stockStatus` (`in_stock|out_of_stock|…`). It may also have `stockSyncedAt`, `stockAvailabilityText`, `etaDate`.
- **Variant:** `available`, sometimes `stock`, plus the ids `sourceUrl` / `externalId` / `sku` / `shopifyVariantId`.
- A **missing** field is not the same as 0: Mongoose fills `DEFAULT_STOCK` (1000). Don't add `stock` to variants that don't have it.

**Storefront behaviour** (after the 2026-10-30 fixes; check they're deployed)
- **Product page:** the add-to-basket cap uses product-level `stock`. It's also blocked when the **selected variant** has `available === false` (`ProductSection.tsx`).
- **Picker:** sold-out options are struck through and **can't be chosen**. Options sold out in every combination are disabled (`ProductVariantPicker.tsx`, `ui/VariantSelect.tsx`).
- **Checkout:** Shopify's hosted checkout is the final gate. It only blocks if the variant is **tracked + `DENY`** at 0.

**Shopify Admin GraphQL**
- **Auth:** env `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, using the client_credentials token (`.scratch/_stock-sync/shopify-lib.cjs`). The API version is in `src/lib/shopify/config.ts`.
- **Location:** `locations(first:10, includeInactive:false)` → use the active one (currently "255 Wricklemarsh Road").
- **Bulk read:** `nodes(ids:[≤100 variant GIDs]){ … on ProductVariant { inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:…){ id } } } }`.
- **Set to 0:** `inventorySetQuantities` (`name:"available"`, `reason:"correction"`, `ignoreCompareQuantity:true`), ≤ 250 per call. **Only for variants already tracked.**
- **Settings (only when the user asks):** `productVariantsBulkUpdate(productId, variants:[{ id, inventoryPolicy: DENY, inventoryItem:{ tracked:true } }])`.
  - A variant that **starts** tracking has no stock until you set it. Set its quantity straight away in the same loop: sold out → 0; in stock → the product's existing `stock`. Abort if an in-stock variant would get 0.
  - Skip, and report, any item not stocked at the location. Don't activate new locations.

**Things that can undo or overwrite your work. Check them every run.**
- **Admin auto-pull.** While any `/admin` tab is open, `ShopifyAdminAutoSync` → `pullAllFromShopify` pulls the ~8 most recently updated Shopify products into Mongo every 90 s. It overwrites name, description, price, category, specs and product `stock`.
  - Product `stock` now comes from `totalInventory` (fixed 2026-10-30 in `inbound.ts` / `pull-products.ts`). Before that it was the first variant's quantity.
  - Still: write Shopify with **single-variant products last**, then report the 10 most recently updated products.
- **Auto-push.** `pushUnsyncedProducts` pushes products whose `updatedAt > shopifySyncedAt`. Write Mongo with the raw driver and **don't touch `updatedAt`**.
- **Webhooks.** List `webhookSubscriptions`. If `PRODUCTS_UPDATE` is registered, its handler upserts like the auto-pull, so warn the user.
- **Concurrent writers.** Settings changed under us mid-run once (≈4,650 variants flipped by something else). Re-read state just before writing, and verify after.
- **Old brand scripts that force stock** (e.g. `scripts/sync-<brand>-prices-from-live.cjs` setting every variant `available:true`). Warn the user; never run them.

---

## 2. The live site: read availability, not quantities

**Shopify supplier sites**
- `/products.json?limit=250&page=N` returns every product with `variants[].id` and `variants[].available`. It's a handful of requests for the whole catalogue (618 products in 3 requests).
- Send a browser user-agent and the market cookie (e.g. `localization=GB; cart_currency=GBP`). Pause about 1 s between pages.
- Refuse to trust a result with far fewer products than expected.

**Don't probe quantities through the cart** (`/cart/add.js` with qty 9999 → "Only N items were added…").
- It works, but the cart endpoint rate-limits after ~15 requests (429). Pushing on brings up Shopify's bot check ("Verifying your connection…").
- Never go faster or parallel to get past it, and never rotate IPs. If the user insists on real quantities, ask them to get a stock feed or CSV from the supplier.

**Other platforms**
- WooCommerce: `/wp-json/wc/store/v1/products?per_page=100` (`is_in_stock`).
- Magento: `/graphql` (`stock_status`).
- Otherwise: JSON-LD `offers.availability`, or the page's stock text.
- If the site shows bot protection or needs a login: **stop and tell the user**.

**How the live site handles stock (report it once per brand, with evidence).** Does it block at 0? Are sold-out options disabled? Are sold-out products still listed? Are pre-order or back-order labels used? Is a quantity ever shown?
Aica, for example: it blocks at 0, disables sold-out options (theme `sold_out_options: "disabled"`), preselects the first available option, keeps sold-out products listed and never shows a quantity.

---

## 3. Steps

### 1. Our side (read-only)
- Brand doc (DB1) → products in its cluster, plus strays in the other.
- Counts: products, variants, Shopify ids.
- Current distribution of `available` / `stock` / `stockStatus`.
- Shopify `policy × tracked × quantity` distribution.
- Webhooks.

**Match key.** It must be complete and unique, so measure both. Try these in order:
1. `variants[].externalId`
2. the live variant id in `variants[].sourceUrl` (`?variant=<id>`)
3. product `sourceProductId` / `sourceUrl` plus option values
4. SKU, **only if unique** (duplicates are common: Aica had 1,298)

### 2. Live availability (read-only)
- Read the whole catalogue (§2) and save `.scratch/<brand>/stock-<date>.json`.
- Variant ids we hold that are missing from live = **gone from live** → sold out.
- Live products we don't have: report them only.

### 3. Plan and validate (no writes)
For each variant: sold out on live, or gone → target `available:false` and Shopify qty 0. In stock on live → **leave as is**.

**Product:**
- All variants sold out → `stock:0`, `isOutOfStock:true`, `stockStatus:"out_of_stock"`.
- Some variants sold out → `stock` = sum of the remaining in-stock quantities, `in_stock`.
- If the variants have no quantities, keep the product `stock` unless it's fully sold out.

**Abort if any of these fail:**
- every product and variant is accounted for
- match keys are unique
- every target is an integer ≥ 0
- `available === (stock > 0)` wherever both exist
- product `stock` = the sum of its variants (when variants carry quantities)
- unresolved variants ≤ 1%. A product with **any** unresolved variant is **skipped entirely** and listed.

Report:
- how many variants are sold out on live
- how many are already right
- how many to fix in the DB, in Shopify, and at product level
- how many are back in stock on live but sold out on ours (report only, unless the user wants those corrected too)
- examples

### 4. Write Shopify (backup first)
- Back up every variant's policy, tracked, quantity and inventory-item id to `shopify-backup-<ts>.json`.
- Set qty 0 on tracked sold-out variants. Multi-variant products first, single-variant last.
- Log every `userErrors`; abort on systematic errors.

### 5. Write the DB (backup first)
- Back up the brand's stock fields to `db-backup-<ts>.json`.
- One `updateOne` per changed product (`bulkWrite`, `ordered:false`):
  - `$set` existing product fields
  - `variants.$[vN].available` with `arrayFilters` on the match key (e.g. `{"vN.sourceUrl": …}`)
- **Never rewrite the `variants` array.** Confirm the matched count equals the products written.
- Keep a rollback that restores the backup (`$unset` anything that didn't exist before).

### 6. Verify everything (not a sample)
- Re-read **every** product and variant from the DB and **every** Shopify variant: an exact match with the targets, no new fields, no settings changed (unless asked).
- Re-read live availability and confirm it agrees for **every** variant.
- Fetch 2–3 of our product pages (`curl https://www.linxsquare.co.uk/products/<slug>`) and confirm "Out of stock" appears for a fully sold-out product.
  - Related-product rails also contain "Add to Cart" and stock numbers, so look at the main product.
  - Pages can be cached (`x-vercel-cache`). A hard refresh or ISR expiry fixes it. `revalidateProductCaches()` only works inside Next.js, not from a script.
- **Final report:**
  - what changed and what was skipped (and why)
  - backup paths and the rollback command
  - anything that could still sell sold-out items (e.g. `CONTINUE` / untracked variants)
  - sample products to check: fully sold out, partly sold out (name the sold-out option), fully in stock, gone from live

### 7. Re-run / schedule
The check step (read live, compare, report) takes seconds, and should write only when something is wrong (`MODE=check|apply`, see `.scratch/_stock-sync/aica-oos.cjs`). Offer a schedule; only set one up if the user asks.

---

## 4. Allowed writes, existing values only
- **DB:**
  - variant `available`
  - product `stock`, `isOutOfStock`, `stockStatus`
  - `stockSyncedAt` / `stockAvailabilityText` / variant `stock` **only where the doc already has them**
- **Shopify:** `available` quantity = 0 at the active location, for variants that already track stock.
- **Only when the user explicitly asks:**
  - Shopify `inventoryPolicy: DENY` / `tracked: true`, with immediate quantities for newly tracked variants
  - brand slug fixes
  - storefront code fixes
- Never delete products or variants.
