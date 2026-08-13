# Product → Google Sheet sync

> **Two ways to do this.** This document covers the service-account sync, run
> from the command line. If you'd rather avoid Google Cloud setup entirely,
> see [google-apps-script/README.md](google-apps-script/README.md) — a script
> that lives in the sheet and pulls from the deployed site on a timer.

Keeps the [LINX Living products sheet][sheet] in step with the `products`
collection. New products are appended automatically; existing rows are left
alone.

[sheet]: https://docs.google.com/spreadsheets/d/1k8zyvooR7VFWaQptu4JFd2ry93mvL6FJ6myOj3gc_i4/edit

## Why it reads Mongo, not the app

Products reach the database three ways:

| Path | Where |
| --- | --- |
| Admin UI | `createProduct()` — `src/app/actions/admin.ts:388` |
| Shopify webhook | `upsertMongoProductFromShopify()` — `src/lib/shopify/inbound.ts:308` |
| Bulk import scripts | ~112 scripts in `scripts/` writing to Mongo directly |

Hooking the first two would silently miss the third — which is how the bulk of
the current 18,697 products were created. The sync therefore reads Mongo (the
source of truth) and catches all three.

## One-off setup

1. **Create a service account.** In the [Google Cloud console][gcp], make a
   project, enable the **Google Sheets API**, create a service account, and
   download its JSON key.

2. **Save the key** to the repo root as `google-service-account.json`
   (already covered by `.gitignore` — never commit it).

3. **Share the sheet with the service account.** Open the sheet → Share →
   paste the `client_email` from that JSON (looks like
   `something@project-id.iam.gserviceaccount.com`) → give it **Editor** →
   uncheck "Notify people" → Share.

   This is the step that is easiest to miss. Without it every call fails with
   `The caller does not have permission`.

4. **Add to `.env.local`:**

   ```sh
   GOOGLE_SHEET_ID=1k8zyvooR7VFWaQptu4JFd2ry93mvL6FJ6myOj3gc_i4
   GOOGLE_SHEET_TAB=All Products
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./google-service-account.json
   ```

   On a host where you cannot drop a file, use
   `GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'` instead.

[gcp]: https://console.cloud.google.com/

## Running it

```sh
npm run products:sync         # append products not yet in the sheet
npm run products:sync:dry     # report what would be added, write nothing
npm run products:sync:test    # one small brand only — a safe first real write
npm run products:sync:full    # wipe and rewrite every row (use after a schema change)
npm run products:sync:watch   # stay running; sync live as products are inserted
npm run products:xlsx         # regenerate the local .xlsx instead
```

### Recommended first run

1. `npm run products:sync:dry` — verifies credentials, sheet access, and the
   diff without touching the sheet.
2. `npm run products:sync:test` — writes **Natura Flooring only** (37 rows).
   Check the sheet looks right: header, prices, categories, no mangled text.
3. `npm run products:sync` — appends the remaining ~18,660 products.

If step 2 looks wrong, clear the tab and adjust before committing to the full
set. Any brand works:

```sh
npm run products:sync -- --brand="Spectra"          # 82 products
npm run products:sync -- --brand="Otto Tiles"       # 357 products
```

An unrecognised name fails with the list of valid brands rather than silently
syncing nothing. `--brand` cannot be combined with `--full`, since `--full`
clears the sheet first and would delete every other brand's rows.

## Making it automatic

Pick one.

**Cron — every 15 minutes.** Simplest, and fine because the sheet is a report
rather than a live view. `crontab -e`, then:

```cron
*/15 * * * * cd /Users/omerhassan/Desktop/LinxLiving/linx-living && /usr/bin/env node --require ./scripts/mongo-dns.cjs scripts/sync-products-to-google-sheet.cjs >> /tmp/linx-product-sync.log 2>&1
```

**Watch mode — near-instant.** Uses a Mongo change stream, so an insert from
any source triggers a sync within ~10s (bursts are coalesced so a bulk import
of 2,000 products causes one pass, not 2,000).

```sh
npm run products:sync:watch
```

Needs a process that stays up — run it under `pm2`, a `launchd` job, or
alongside the app. Requires a replica set, which Atlas provides.

**After a bulk import.** Append to any import script's run:

```sh
node scripts/import-whatever.cjs && npm run products:sync
```

## How rows are matched

Column A is `Product ID` — the Mongo `_id`. The sync reads that column, and
appends only products whose id is absent. So it is safe to re-run at any time
and will never double-append.

Two consequences worth knowing:

- **Don't sort or delete column A** in the sheet, or the sync loses track and
  re-appends everything. Sorting other columns is fine.
- **Edits to a product in Mongo do not update its existing row.** The sync adds
  new products; it does not rewrite old ones. Run `products:sync:full` to
  refresh prices and details across the board.

## Columns

Defined once in `scripts/lib/product-rows.cjs` and shared by both the sheet
sync and the `.xlsx` export, so the two cannot drift. Adding a column there
changes both — then run `products:sync:full` to rewrite the sheet with it.

Long text is trimmed (descriptions to 1,500 chars, specs/dimensions to 600) to
keep the file and the sheet responsive. Override with `DESC_MAX=32000`.
