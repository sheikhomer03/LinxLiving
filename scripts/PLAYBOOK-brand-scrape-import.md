# Brand scrape → import playbook

The prompt to run for every new supplier site (Al Murad was the first; reuse
this verbatim for Capietra, Domus Group, Tiles Porcelain, Total Tiles, Walls
and Floors, Trade Choice, and any brand after). Copy the block below and fill
in `<BRAND>` / `<SITE>`.

---

## The prompt

> Import **<BRAND>** (`<SITE>`) into the existing catalogue. Follow this
> process exactly — do not skip a verification step because a shortcut looks
> safe, and do not touch anything that already exists.
>
> **Strict rules (non-negotiable):**
> 1. **Insert-only.** Every write is a brand-new document. No `updateOne`,
>    `updateMany`, `bulkWrite`, or `deleteOne` against the `products`
>    collection anywhere in the *import* script. Dedupe against `sourceUrl`
>    in BOTH clusters before every insert. Add a document-count safety check
>    (before vs. after) that throws if the delta doesn't exactly match what
>    this run inserted.
>    - A **correction pass** discovered after the import (a parsing bug found
>      during later audits) is the one legitimate exception — and even then,
>      every write is `updateOne({ _id, brand: brand._id }, { $set: {...} })`
>      scoped to that one brand's own product, matched by a stable key
>      (`sourceUrl`), never a blanket `updateMany`. Dry-run it first, log a
>      before/after count, and never touch a field the correction isn't
>      specifically about.
> 2. **No new categories/menus.** Query the live `products` collections
>    first (`distinct("category", { department })` on both clusters) and
>    build a mapping table from every <BRAND> category name onto a slug that
>    already exists. Never invent a slug, never write to `menus`.
> 3. **Stock fixed at 500** for every product (not the schema default).
> 4. **Images**: scraped supplier URLs go into `images[]` only as the seed
>    for the Shopify upload; after the Shopify push confirms each
>    `shopifyUrl` (see `shopify-harvest-brand-images.cjs`), rewrite
>    `images[]` to hold only the Shopify CDN URLs. No Cloudinary step, no
>    supplier URLs left in the DB afterward. Re-run the harvest script if any
>    products come back "still processing" — Shopify's own media pipeline
>    can lag behind the create call.
> 5. **Whichever cluster has more headroom stays the same for the whole
>    brand** — check `db.stats()` on both `MONGODB_URI` and `MONGODB_URL2`
>    first, set the new `Brand.dataCluster` accordingly, and never split one
>    brand's products across both.
> 6. **Description is one spec per line, not one dense sentence.** The PDP
>    (`ProductDetailTabs.tsx`) splits a plain-text description on `\n` into a
>    lead line + a bulleted list — matching how the *source site itself* lays
>    a spec table out. Build `description` by joining `"label: value"` pairs
>    with `"\n"`, never `". "` (a single run-on paragraph is a real defect,
>    not a style choice — it was caught and fixed after Al Murad's first
>    pass). Products with no structured specs (accessories/tools with only
>    free-text marketing copy) fall back to that raw prose as-is, not to a
>    "\n"-joined list.
>
> **Step 0 — before any scraping work, confirm the site is actually
> importable as planned:**
> - **Pricing check**: fetch 6-8 product pages across different categories.
>   If any show a login/trade-account gate instead of a price (Trade
>   Choice), or the entire site publishes no price anywhere at all (Domus
>   Group — a specifier/architect catalogue, not a store), **stop and ask
>   the user** how to handle price before writing a single line of scraper
>   code: authenticate a session, import everything at price 0, or hold off
>   entirely. Don't assume "some products are gated, others aren't" —
>   verify it explicitly across several categories; it is usually uniform
>   one way or the other.
> - **Bot-check / CAPTCHA**: hit a handful of pages with a normal UA and
>   check for an "are you human" page (Al Murad had one, bypassable via an
>   `ayh_access` code exposed in the page's own JS). If present, solve it
>   before planning the crawl shape, not after.
> - **Rendering**: confirm pages are server-rendered HTML (`curl` with a
>   plain UA shows real content) vs. a JS SPA shell that would need a
>   headless browser. Check for a JSON-LD `<script type="application/ld+json">`
>   block — if present, prefer it as a primary data source; if absent
>   (common), plan on parsing the rendered DOM directly.
> - **Crawl entry point**: check `/sitemap.xml` / `/sitemap_index.xml` first
>   — if it lists product URLs directly, that's both faster and more
>   complete than crawling category pages. If it 404s (no sitemap — this
>   happened on Domus Group), the category/material listing pages are the
>   only discovery path; note their pagination mechanism (`?page=N` query
>   param, infinite scroll, numbered links) before writing the crawler.
> - Report all of this back before proceeding — a site that turns out to be
>   priced-gated or CAPTCHA'd changes the whole plan, and finding out mid-way
>   through a 3,000-product scrape is expensive.
>
> **Process, in order — verify after every stage, don't just assume the
> previous stage worked:**
>
> 1. **Verify the seed category file** (if one exists) against the live
>    site's own nav — fetch the homepage, extract every category link,
>    diff against the file. A raw crawl dump (mixing real product
>    categories with brand pages, branch/office locations, legal pages,
>    offers/news, and asset files) is not the same thing as a clean seed —
>    filter it down to genuine product-listing URLs before treating it as
>    the category tree. Watch for the same taxonomy appearing under two URL
>    shapes (Domus Group: `/products/materials/X` and `/category/X` are the
>    SAME underlying catalogue, not two separate ones — confirmed by
>    matching "N Ranges" counts and overlapping product slugs on both).
>    Report anything missing, and anything the user needs to explicitly
>    exclude (e.g. "leave out Carpet and Carpet Tiles"), before going
>    further.
> 2. **Full category-tree discovery crawl** (read-only): walk every
>    category → every subcategory → every paginated page, collecting every
>    product URL, deduped by the product's own numeric/slug ID (a product
>    is cross-listed under many filter/category paths — one canonical page
>    per product, not one row per path it's listed under). Checkpoint to
>    disk, resumable. Report the total unique product count and don't
>    proceed until it's a plausible number for the site's real size.
> 3. **Detail-scrape every product URL** (read-only): title, price (and
>    its actual unit — verify against the site's own on-page coverage
>    calculator or checkout math, don't assume; skip entirely per Step 0 if
>    price isn't accessible), full image gallery, structured specs,
>    stock/availability, RRP/was-price (with its unit), category assignment,
>    SKU, variant codes (colour/size options — Domus Group exposes these as
>    `data-variant-id` swatches with a `?tile=CODE` query param, not a
>    dropdown `<select>`). Checkpoint to a JSONL capture so a bug fix never
>    requires re-crawling from scratch — always keep the raw extracted text
>    (`rawSpecsText` or equivalent) alongside the parsed fields, precisely
>    so a parsing fix can be re-applied to cached data without hitting the
>    network again.
> 4. **Audit the capture before writing anything**, and treat every one of
>    these as a real bug to hunt down, not an acceptable gap:
>    - Average images per product — if it's suspiciously close to 1 across
>      the board, the gallery parser is probably only catching the hero
>      shot; fetch one product's raw HTML and check for a JS-embedded
>      gallery array the regex isn't matching.
>    - % of products with zero parsed specs — pull a sample of the zero
>      cases' raw HTML directly and check whether the spec data is present
>      on the page under a DIFFERENT tab/element than the one being parsed
>      (tab order is not guaranteed to be stable across products — anchor
>      extraction on the tab's own label/id, never "the first occurrence of
>      this CSS class").
>    - **Label-matching robustness — this is where most of the real bugs
>      hid on Al Murad, all four found only by re-auditing after the first
>      "fix" looked done:**
>      - Case sensitivity: the same label can render in title case on one
>        range and sentence case on another ("N° of Tiles per Pack" vs.
>        "N° of tiles per pack"). Match case-insensitively, always.
>      - The separator (usually `:`) is sometimes just... absent
>        ("...Square Metre (m2) 46.91" with no colon at all). Make it
>        optional in the regex, not mandatory.
>      - A label can be split by a stray space where the source wrapped
>        part of it in an inline tag ("Square Me<b>tre" → "Square Me
>        tre" after tag-stripping). Allow flexible whitespace between
>        EVERY character of the label, not just at its own pre-existing
>        word boundaries.
>      - **Word-boundary matching is mandatory.** A short label
>        ("Pattern", "Edge") will match as a bare substring inside a
>        longer, unrelated word in flowing prose ("patterns create a
>        flair..." on a mosaic product's marketing copy) — wrap the
>        pattern in `(?<![a-zA-Z])...(?![a-zA-Z])` so it can only match a
>        whole word.
>      - **Ordinary English words used as spec labels are dangerous on
>        accessory/tool pages.** "Material", "Finish", "Edge", "Colour",
>        "Pattern" are common words that show up naturally in usage
>        instructions ("...the material to be applied...", "...hung from
>        the edge of the bucket..."). Require a literal colon for these
>        specific labels (genuine spec entries always have one; ordinary
>        sentence usage essentially never does) while leaving numeric
>        coverage labels colon-optional, where a confirmed real case
>        needs it.
>      - **Never cap the last matched label's value at an arbitrary
>        character count.** A "safety" truncation (e.g. 160 chars) will
>        silently chop off real marketing/usage copy for tools, adhesives,
>        sealants, and multi-paragraph descriptions ("...providing
>        professional results for both t" — cut mid-word). Let it run to
>        the end of the text; if a *numeric* label's value then risks
>        swallowing trailing unrelated prose (a source page running
>        straight from a coverage figure into flowing description text
>        with no separator), cap ONLY that class of value to its leading
>        number + unit word via a small regex, not the whole field.
>      - After any label-matching fix, **re-run the fix against the
>        WHOLE cached catalogue**, not just the one product that surfaced
>        the bug — Al Murad needed four separate rounds of this (each
>        "final" fix uncovered the next bug on re-audit) before the
>        remaining residue was small enough to be genuine source-content
>        oddities rather than scraper defects. Expect this, don't treat
>        the first clean-looking pass as done.
>    - Price/RRP unit consistency — compute the ratio of current price to
>      RRP across the whole catalogue; a cluster of ratios near 0 or above
>      1 means a unit mismatch (per-m² vs per-tile, inc vs ex VAT), not a
>      real discount. Never store a "was" price you can't convert onto the
>      same unit as the live price — leave it null rather than guess, and
>      never store one that's ≤ the current price.
>    - Category-mapping coverage — run the import in `DRY_RUN` and check
>      how many products got zero mapped category. If it's more than a
>      handful, the site's real per-product category data (often JSON-LD)
>      is richer than the nav file — check for compound/joined category
>      strings (e.g. `"Parent/Child"`) being treated as one atomic name
>      instead of being split.
> 5. **Fix and re-scrape** whenever step 4 finds something — every field a
>    fix touches needs the whole catalogue re-verified, not just the one
>    sample product it was found on. Re-run the full audit after every fix
>    until the numbers are clean. If the capture (JSONL) already has the raw
>    text cached, a parsing fix can usually be re-applied to the cached data
>    directly — no need to re-hit the network.
> 6. **Cross-check the DB write shape against how the site actually
>    renders an existing product** — don't just satisfy the Mongoose
>    schema. Pull one real, live, correctly-rendering product from the
>    same department and diff field-by-field. Critically: **grep the
>    frontend component code itself** for every place it reads
>    `pickSpec(specs, "...")` or an equivalent free-form lookup — many
>    UI-critical values (price-per-m² calculators, size, pack coverage)
>    are read from aliased keys inside the `specs` bag, not from the typed
>    top-level schema fields, and setting only the "correct" typed field
>    silently leaves the on-page calculator broken or showing a wrong
>    number. Trace the actual calculation function (not just the prop
>    names) and verify its output against a real number the source site
>    itself displays (e.g. "7 tiles to cover 1.10m² = £31.43") before
>    trusting it.
> 7. **Final dry run**: 0 skipped for "already existed" (unless re-running
>    on purpose), 0 skipped for "no mappable category", 0 scrape errors.
>    Report the real numbers, not just "looks good."
> 8. Only then run the real (non-dry) import, then push to Shopify
>    (`shopify-sync-brand.cjs BRAND="<BRAND>" FORCE_DRAFT=1`), then harvest
>    the resulting Shopify image URLs and rewrite `images[]`
>    (`shopify-harvest-brand-images.cjs BRAND="<BRAND>" THEN_REWRITE=1`,
>    re-run if anything is left "still processing"), then activate once
>    reviewed (`shopify-activate-brand.cjs BRAND="<BRAND>"`, which also
>    flips `Brand.isActive`). Report before/after counts at every step —
>    a long-running write loop against Mongo should paginate by `_id` in
>    batches (200-ish) rather than holding one long-lived cursor open, which
>    can hit the server's cursor idle timeout partway through a slow,
>    per-document-round-trip pass.
> 9. **Re-verify categories after the fact, independently** — don't just
>    trust the dry-run's "0 unmapped" count from step 7. Group the
>    imported products by their real top-level `(department, category)`
>    pair (not by unwinding a multi-value `categories[]` array against a
>    single top-level `department`, which produces false-positive
>    "invented category" alarms when a product's *secondary* tag belongs to
>    a different department than its primary one) and confirm every pair
>    already exists elsewhere on the site. Spot-check a random sample of
>    product-name-vs-assigned-category pairs for sanity.
>
> Report honestly at each stage — if something is broken, say so and fix
> it before moving on, rather than presenting partial progress as done. If
> a residual issue turns out to be the SOURCE site's own content quality
> (e.g. one product range's marketing copy genuinely interleaves spec-like
> phrases into flowing prose with no clean machine-separable boundary), say
> so explicitly and show the evidence, rather than either hiding it or
> chasing an unbounded number of increasingly specific heuristics to reach
> a fictitious 100%.

---

## Reusable scripts from the Al Murad run

- `scripts/capture-al-murad.cjs` — the two-stage crawler/scraper. Copy and
  adapt the site-specific parsers (bot-check bypass, gallery/spec/RRP
  extraction, label-matching per the robustness rules above) for the new
  site; the discovery-crawl and checkpointing structure is reusable as-is.
- `scripts/import-al-murad.cjs` — the insert-only importer, category-mapping
  table, safety-check pattern, and `specs` alias wiring are all reusable
  patterns; only `CATEGORY_MAP` and the field-extraction logic need
  rewriting per site. Note the `description` field joins spec pairs with
  `"\n"` (one per line), not `". "` — see the strict rules above.
- `scripts/shopify-sync-brand.cjs` — cluster-aware Shopify push (reads
  `brand.dataCluster`, unlike the older primary-only sync script). Use
  `FORCE_DRAFT=1` for a brand's first push so nothing is purchasable until
  reviewed.
- `scripts/shopify-harvest-brand-images.cjs` — fills `shopifyImages[]` with
  the real Shopify CDN URLs after a brand push (the push itself never
  records them), matching by position since no per-image id exists yet.
  `THEN_REWRITE=1` collapses `images[]` down to those URLs in the same pass.
- `scripts/shopify-activate-brand.cjs` — flips a brand's products from
  DRAFT to ACTIVE and publishes to the Online Store sales channel, then
  sets `Brand.isActive = true` once every product succeeds.

## What actually went wrong on Al Murad (so it isn't repeated)

1. Gallery regex anchored on the full `https://domain/images/...` URL missed
   the real multi-image gallery, which was a JS array using relative,
   backslash-escaped paths (`Product.setDefaultImages([...])`) — first pass
   returned 1 image for products that actually had up to 8.
2. Spec parser only read the JSON-LD `Description` field, blank for ~27% of
   products even though the real spec table was in the rendered tab.
3. That tab extractor then matched by CSS class alone, which every one of
   the page's three tabs (Description, Payment & Security, Delivery &
   Returns) shared — silently pulled the wrong tab's text for ~1,300
   products until it was anchored on the tab button's own label instead.
4. JSON-LD `category` entries were compound strings (`"Parent/Child"`) for
   cross-listed products; stripping only a trailing slash left ~1,000
   products with zero mappable category until the string was split on `/`.
5. The site shows the same price at two units side by side (per-m² display,
   per-tile transactional); a naive "first unit label on the page" grab
   picked the wrong one for every product with that layout.
6. RRP figures needed unit-aware conversion onto the live price's own unit,
   with a hard `perSqm > 0` guard — the first version silently fell back to
   the raw, unconverted number when it couldn't convert, which would have
   shown a fabricated discount on every product missing that one spec.
7. The DB schema's typed top-level fields (`packCoverageM2`, `pricePerSqm`,
   `unitOfMeasure`) are NOT what the PDP's own calculator component reads —
   it reads specific alias keys inside the free-form `specs` object. Setting
   only the typed fields would have shipped a catalogue where every product
   page rendered fine but the coverage calculator was silently broken or
   wrong.
8. `description` was built by joining spec pairs with `". "` — a single
   dense run-on paragraph. The PDP already splits a plain-text description
   on `"\n"` into a lead line + a bulleted list (matching the source site's
   own layout); joining with `"\n"` instead was the fix, applied as a
   catalogue-wide correction pass after the fact.
9. The label-matching regex itself needed four separate rounds of fixes,
   each only found by re-auditing the WHOLE catalogue after the previous
   fix looked complete — case sensitivity, an optional-not-mandatory colon,
   fully-flexible whitespace (not just at pre-existing word boundaries), a
   word-boundary guard (a short label matching mid-word inside unrelated
   prose), and a mandatory colon specifically for labels that double as
   ordinary English words on accessory/tool pages. See the detailed
   robustness rules in the prompt above — treat all of these as the
   default starting point for the next site's parser, not something to
   rediscover from scratch.
10. The last matched label's value was capped at a fixed 160 characters
    "for safety" — this silently truncated real marketing/usage copy for
    tools, adhesives, and sealants mid-sentence. Removing the cap (and
    instead bounding only genuinely numeric labels to their leading
    number + unit word) recovered the lost content without reintroducing
    the swallowing-into-prose problem.
11. A correction script iterating one document at a time via a single
    long-lived `find()` cursor hit the server's cursor idle timeout partway
    through a ~3,700-product pass (`cursor id ... not found`). Paginating
    by `_id` in batches of ~200 (re-querying each batch fresh) instead of
    holding one cursor open for the whole pass fixed it — and made the
    script resumable/idempotent as a side effect, which mattered again
    when the crashed run needed a straightforward re-run to finish.

## What actually went wrong on Trade Choice / Domus Group (site-selection stage)

12. Trade Choice gates ALL pricing behind a trade-account login, uniformly,
    with zero public-priced exceptions — confirmed by checking 8 products
    across 7 different categories before concluding this, not by assuming
    from one product. Domus Group publishes NO price anywhere on the site
    at all (a specifier/architect catalogue — "Order Sample" is the only
    CTA, not "Buy"). Neither was discovered until Step 0's explicit
    multi-category pricing check — always run that check before writing
    scraper code, and always ask the user how to handle price (0, a
    fixed/derived value, or hold off) rather than assuming.
13. Domus Group has no `/sitemap.xml` or `/robots.txt` (both 404) — the
    only product-discovery path is crawling the category/material listing
    pages, which paginate via a plain `?page=N` query param up to a page
    count shown in the pagination UI itself. Always check for a sitemap
    FIRST (it's faster and more complete when present); don't assume one
    exists.
