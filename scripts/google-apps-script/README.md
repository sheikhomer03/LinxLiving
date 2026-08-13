# Option B — Apps Script inside the sheet

An alternative to the service-account sync in
[`../README-product-sync.md`](../README-product-sync.md). The script lives in
the spreadsheet itself and runs **as you**, so there is no Google Cloud
project, no service account, and no sharing step.

|  | Apps Script (this) | Service account |
| --- | --- | --- |
| Google Cloud setup | none | project + Sheets API + JSON key |
| Share sheet with a robot | no | yes, as Editor |
| Where it runs | Google's servers | your machine / a host |
| Needs your laptop on | no | yes, unless hosted |
| Needs the site deployed | **yes** | no |
| Speed | ~hourly | hourly, or live via `--watch` |

Use this one if you'd rather not touch Google Cloud. Use the other if you want
live syncing or the site isn't deployed.

## How it fits together

Apps Script can't reach MongoDB, so it pulls from an endpoint on the site:

```
Google Sheet ──hourly trigger──▶ Apps Script
                                     │  GET /api/products/sheet-feed
                                     ▼
                            linxsquare.co.uk  ──▶  MongoDB
```

The endpoint is [`src/app/api/products/sheet-feed/route.ts`](../../src/app/api/products/sheet-feed/route.ts).

## Setup

### 1. Set the shared secret on the site

Pick a long random string:

```sh
openssl rand -hex 32
```

Add it to the Vercel project's environment as `PRODUCT_SHEET_SECRET` (and to
`.env.local` for local testing), then redeploy. Until it is set, the endpoint
returns 401 to everyone — including you.

### 2. Install the script

1. Open the sheet → **Extensions → Apps Script**.
2. Delete the contents of `Code.gs` and paste
   [`ProductSync.gs`](ProductSync.gs).
3. Save, then reload the spreadsheet. A **LINX Sync** menu appears.

### 3. Connect it

**LINX Sync → Set up (first time)**, and paste the same secret. Google will ask
you to authorise the script on first run — that's the standard "this script
wants to connect to an external service" prompt.

It confirms by fetching the column list and writing the header row.

### 4. Test with one brand first

**LINX Sync → Sync one brand…** and enter `Natura Flooring` (37 products).
Check the sheet looks right before pulling all ~18,700.

### 5. Turn it on

- **LINX Sync → Sync now** — pulls everything (see paging note below).
- **LINX Sync → Enable hourly auto-sync** — installs the recurring trigger.

## Menu reference

| Item | What it does |
| --- | --- |
| Set up (first time) | Stores the API secret, writes the header |
| Sync now | Appends every product not already in the sheet |
| Sync one brand… | Same, restricted to one brand |
| Enable hourly auto-sync | Time-based trigger, once an hour |
| Disable auto-sync | Removes the trigger |
| Reset sync position | Forgets the paging cursor and rescans from the start |

## Things worth knowing

**The first full sync takes several runs.** Apps Script kills any execution at
6 minutes. The script stops itself at 4.5 minutes and saves its position, so
the next run resumes from there. With the hourly trigger on, ~18,700 products
settle within a few hours. To finish sooner, just pick "Sync now" again a few
times.

**Duplicates can't happen.** Rows are matched on column A (`Product ID`, the
Mongo `_id`) — the script reads what's already there and skips it. That is also
why you shouldn't delete or reorder column A. Sorting other columns is fine.

**Only new products are appended.** Price or description changes to a product
already in the sheet won't appear. Delete the tab's rows and re-sync to rebuild
it, or use `npm run products:sync:full` from the other setup.

**One run at a time.** A `LockService` lock stops an hourly trigger from
overlapping a manual sync and racing on the same rows.

## Testing done

The endpoint was checked against the live database:

```
fetched 2000 rows over 8 page(s) of 250
duplicates: 0                     [expect 0]
order matches Mongo: true         [expect true]
missing rows: 0                   [expect 0]
unexpected rows: 0                [expect 0]
brand filter → 37 rows, brands: Natura Flooring
unknown brand rejected with 400: true
RESULT: PASS
```

Paging uses a keyset cursor on `(createdAt, _id)` rather than skip/limit, so
products inserted mid-sync can't shift the window and cause a skipped or
repeated row. The slice tested contained a `createdAt` shared by two products,
which is the case a plain date cursor gets wrong.

The `.gs` file itself has not been run inside Apps Script — that needs the
secret deployed and the script pasted into the sheet.
