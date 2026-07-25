# Shopify integration — LinxLiving / Linx Square

This app keeps your **custom Next.js admin + storefront UI** and uses Shopify as the commerce backend for products (and later cart/checkout/orders).

## Architecture (target)

```
Next.js Admin  →  Admin API  →  Shopify
Next.js Storefront  ←  Storefront API  ←  Shopify
Cart  →  Shopify Cart  →  Shopify Checkout  →  Shopify Order
```

**Phase 1 (implemented now):** dual-write. Creating/editing/deleting a product in your admin also creates/updates/deletes it in Shopify (when env vars are set). The storefront still reads from **Mongo** until you turn on `SHOPIFY_STOREFRONT_ENABLED`.

---

## What you must do in Shopify (manual)

### 1. Create a Shopify store

1. Go to [https://www.shopify.com](https://www.shopify.com) and create a store (trial is fine for development).
2. Note your shop domain: `your-store.myshopify.com` (e.g. `wnbgk0-xu.myshopify.com`).

### 2. Create an app in the Dev Dashboard (required in 2026+)

Shopify no longer creates permanent Admin tokens from **Settings → Develop apps**. Use the Dev Dashboard instead.

1. In Admin: **Settings → Apps → App development**
2. Click **Build apps in Dev Dashboard** (opens [dev.shopify.com/dashboard](https://dev.shopify.com/dashboard/))
3. **Create app** → name it `LinxLiving Connector`
4. Create / release a **version** and set **Admin API access scopes**:

| Scope | Why |
| --- | --- |
| `read_products` / `write_products` | Create & update products |
| `read_inventory` / `write_inventory` | Set stock |
| `read_locations` | Find the stock location |

5. **Release** the version, then **Install app** on your **Linx Square** store
6. Open the app **Settings** in Dev Dashboard and copy:
   - **Client ID**
   - **Client secret**

> There is **no** long-lived `shpat_` to copy. Our app exchanges Client ID + Secret for a token automatically (valid ~24h, auto-refreshed).

#### Storefront API (Cart + Checkout)

Needed for **Shopify Checkout** (cart → hosted payment page).

**If “Create Storefront token” returns Access denied**, your app is missing Storefront scopes. Fix in Dev Dashboard first:

1. Open [dev.shopify.com/dashboard](https://dev.shopify.com/dashboard) → **LinxSquare Connector**
2. Edit the app **version** → **Access scopes**
3. Add these as **required** scopes (must not be optional-only):

| Scope | Why |
| --- | --- |
| `unauthenticated_read_product_listings` | Required for Storefront API eligibility |
| `unauthenticated_read_checkouts` | Read carts / checkout |
| `unauthenticated_write_checkouts` | Create carts → `checkoutUrl` |

4. **Release** the version
5. **Reinstall** the app on `wnbgk0-xu.myshopify.com` (approve the new scopes)
6. In Linx Admin → Settings → Shopify → **Create Storefront token**
7. Paste into `.env`:
   ```env
   SHOPIFY_STOREFRONT_ACCESS_TOKEN=paste_here
   SHOPIFY_CHECKOUT_ENABLED=true
   NEXT_PUBLIC_SHOPIFY_CHECKOUT_ENABLED=true
   ```
8. Restart `npm run dev`

### 3. Confirm a Location exists

**Settings → Locations** — at least one active location is required for inventory.

---

## What you configure in this repo

Copy into `.env` / `.env.local`:

```env
SHOPIFY_STORE_DOMAIN=wnbgk0-xu.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
SHOPIFY_SYNC_ENABLED=true
SHOPIFY_STOREFRONT_ENABLED=false
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your-storefront-token
SHOPIFY_CHECKOUT_ENABLED=true
NEXT_PUBLIC_SHOPIFY_CHECKOUT_ENABLED=true
```

Restart `npm run dev` after changing env.

If token exchange returns `shop_not_permitted`, the store and app are not in the same Dev Dashboard organization — create/link a store under **Dev stores** in the same org, or ensure Linx Square appears under that organization.

---

## Full admin ↔ Shopify map

| Admin area | Direction | Notes |
| --- | --- | --- |
| **Products** | 2-way auto | Core fields + metafields (`tagline`, `specs`, `show_specs`, `schematic_image`, `sub_category`) |
| **Brands** | 2-way auto | Shopify collections (`brand-*`) |
| **Collections** | 2-way auto | Title/image/product membership |
| **Menus** | 2-way auto | Shopify collections (`menu-*`) + product membership by category |
| **Coupons** | 2-way auto | Discount create/update/delete |
| **Customers** | 2-way auto | Signup/profile push + pull/webhooks |
| **Messages** | 2-way auto | Shopify metaobject `linx_contact_inquiry` (needs metaobject scopes) |
| **Storefront catalog** | Hybrid | Mongo IDs + Linx extras; live price/stock/images when `SHOPIFY_STOREFRONT_ENABLED=true` |
| **Orders** | 2-way auto | Checkout/COD → Shopify; admin status → fulfill/cancel |
| **Payments** | Shopify (+ Stripe toggle) | Admin Payments defaults to Shopify orders |
| **Subscribers** | 2-way auto | Newsletter push marketing consent + pull |
| **Addresses** | 2-way | Profile address CRUD ↔ Shopify customer addresses |

Use **Settings → Shopify → Pull everything from Shopify**, then **Enable live webhooks** (ngrok URL).

---

## Code map

| Path | Role |
| --- | --- |
| `src/lib/shopify/config.ts` | Env + feature flags |
| `src/lib/shopify/admin.ts` | Admin GraphQL client + healthcheck |
| `src/lib/shopify/storefront.ts` | Storefront GraphQL client |
| `src/lib/shopify/cart.ts` | Create Shopify Cart → `checkoutUrl` |
| `src/app/api/checkout/shopify/route.ts` | Storefront checkout API used by cart / review |
| `src/lib/shopify/sync-product.ts` | Create / update / delete product in Shopify |
| `src/app/actions/admin.ts` | Dual-write on product CRUD |
| `src/app/actions/shopify.ts` | Manual / bulk sync of existing Mongo products |
| `src/models/Product.ts` | Stores `shopifyProductId`, `shopifyVariantId`, sync errors |

---

## Cart & Checkout (implemented)

1. Customer adds products (Mongo ids; variant GID resolved at checkout).
2. **Checkout** in the cart drawer calls `POST /api/checkout/shopify`.
3. App creates a Storefront Cart and redirects to Shopify hosted Checkout.
4. After payment, Shopify creates the order; webhooks / pull bring it into Linx admin.
5. Optional thank-you page: `/checkout/complete` (Shopify’s own confirmation is primary).

COD still uses the multi-step `/checkout` flow without Shopify payment.

---

## Roadmap (not done yet)

| Phase | Work |
| --- | --- |
| **2 — Catalog** | Point homepage / PDP / search / mega-menu at Storefront API (`SHOPIFY_STOREFRONT_ENABLED=true`); map brands/menus ↔ collections |
| **4 — Orders** | Richer admin order UX from Shopify Admin API (webhooks already pull) |
| **5 — Cutover** | Import remaining Mongo data; decide what stays in Mongo (menus, coupons, CMS) |

---

## Important rules

1. **Never** put `SHOPIFY_ADMIN_ACCESS_TOKEN` in `NEXT_PUBLIC_*` or client code.
2. Avoid editing the same product in **both** Shopify Admin and Linx admin until webhooks exist — dual-write is one-way (Linx → Shopify) today.
3. Keep `SHOPIFY_STOREFRONT_ENABLED=false` until you are ready to migrate catalog reads; otherwise Mongo and Shopify can diverge on the storefront.
4. Card checkout uses Shopify when `SHOPIFY_CHECKOUT_ENABLED` + Storefront token are set; Stripe remains if those flags are off.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Settings shows not connected | Domain + Client ID/Secret; app installed on Linx Square; restart dev server |
| `shop_not_permitted` | App and store must be in the **same** Dev Dashboard organization |
| Product created locally, not in Shopify | Toast/error on create; `shopifySyncError` on product; scopes `write_products` + `write_inventory` |
| Inventory error | Active Location; `read_locations` + inventory scopes |
| Storefront API 401 | Storefront token + Storefront API enabled on the app |
| Checkout says token missing | Create Storefront token in Settings → Shopify; set env; restart |
| Access denied for storefrontAccessTokenCreate | Add `unauthenticated_*` scopes as **required** on the app, release, reinstall, retry |
| Product not linked at checkout | Sync product (needs `shopifyVariantId`) via Push / Pull |
