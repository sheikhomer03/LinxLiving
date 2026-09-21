/**
 * Bring Tile Mountain products up to what tilemountain.co.uk actually shows.
 *
 * The first import read the rendered PDP with regexes and got the headline
 * fields; this reads the page's own data payload (see
 * recapture-tilemountain.cjs) and fills in what that pass could not see:
 * the full description rather than its first paragraph, the range name, the
 * datasheet, cleaning advice, the review score, whether a sample can be
 * ordered, and the sibling colourways their swatch row links to.
 *
 * Additive by design: every write is a `$set` of a field the site states, and
 * nothing already stored is removed. Stock is left alone unless WITH_STOCK=1,
 * because their live figure would take products off sale that are currently
 * sitting on the default floor.
 *
 * Env:
 *   DRY_RUN=1     report only
 *   WITH_STOCK=1  also take stock and the stock wording from the site
 *   RESWATCH=1    rebuild the colour/size rows even where one exists
 *   LIMIT=n       only the first n products
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const ORIGIN = "https://www.tilemountain.co.uk";
const DATA =
  process.env.TM_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";
const CAPTURE = path.join(DATA, "tm-pdp-v2.jsonl");
const DRY_RUN = process.env.DRY_RUN === "1";
const WITH_STOCK = process.env.WITH_STOCK === "1";
/** Rewrite the colour/size rows even where one is already stored. */
const RESWATCH = process.env.RESWATCH === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;

const clean = (v) => String(v == null ? "" : v).trim();
const abs = (u) => (/^https?:/i.test(u) ? u : ORIGIN + (u.startsWith("/") ? u : "/" + u));

/** Key features arrive as one HTML blob of "> line" rows. */
function featuresFrom(html) {
  if (!html) return [];
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .split(/\n+/)
    .map((s) => s.replace(/^\s*[>*\u2022-]\s*/, "").trim())
    .filter((s) => s.length > 1);
}

/** `datasheet_v2` is an anchor (sometimes several) to a PDF guide. */
function downloadsFrom(html) {
  if (!html) return [];
  const out = [];
  for (const m of String(html).matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = abs(m[1].trim());
    const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    if (!/\.pdf(\?|$)/i.test(url)) continue;
    out.push({ title: title || "Product guide", url, sourceUrl: url, type: "pdf" });
  }
  return out;
}

/**
 * The Colour and Size rows above their buy button, whose chips jump to a
 * sibling product.
 *
 * Their variation table lists the whole range at once, but each row is
 * filtered by the other: the colours offered are the ones that come in the
 * size being viewed, and the sizes offered are the ones the current colour
 * comes in. That is why Metro White shows two sizes (300x100 and 200x100,
 * both made in white) while a Paris plank shows none — the herringbone format
 * is not made in Grey Oak, so their size row renders empty. A row with no
 * alternative is not a picker, so it is not stored.
 */
function swatchesFrom(product, ownSlug) {
  const raw = product && product.parent_product && product.parent_product.wood_variation_option;
  if (!raw) return [];
  let rows;
  try {
    rows = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const live = rows.filter(
    (r) => clean(r.status_value) !== "0" && clean(r.url_key || r.url_path),
  );
  const own = live.find((r) => clean(r.url_key || r.url_path) === ownSlug);
  const ownSize = clean(own && own.panel_size_value);

  const chipOf = (r) => {
    const chip = clean(r.wood_panel_color_hex);
    return {
      swatchImage: /^https?:/i.test(chip) ? chip : "",
      colorValue: chip.startsWith("#") ? chip : "",
    };
  };

  const groups = [];

  const colours = [];
  const seenColour = new Set();
  for (const r of live) {
    // Only the colours that come in the size being viewed, as they do.
    if (ownSize && clean(r.panel_size_value) !== ownSize) continue;
    const label = clean(r.wood_panel_color_title || r.design);
    const handle = clean(r.url_key || r.url_path);
    if (!label || seenColour.has(label)) continue;
    seenColour.add(label);
    colours.push({ label, handle, ...chipOf(r), isCurrent: handle === ownSlug });
  }
  if (colours.length > 1) groups.push({ optionName: "Colour", swatches: colours });

  const ownColour = clean(own && own.wood_panel_color_title);
  const sizes = [];
  const seenSize = new Set();
  for (const r of live) {
    // Only the sizes the colour being viewed is made in, as they do.
    if (ownColour && clean(r.wood_panel_color_title) !== ownColour) continue;
    const label = clean(r.panel_size);
    const handle = clean(r.url_key || r.url_path);
    if (!label || !handle || seenSize.has(label)) continue;
    seenSize.add(label);
    sizes.push({ label, handle, swatchImage: "", colorValue: "", isCurrent: handle === ownSlug });
  }
  if (sizes.length > 1) groups.push({ optionName: "Size", swatches: sizes });

  return groups;
}

function readCapture() {
  const out = new Map();
  for (const line of fs.readFileSync(CAPTURE, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec.product || rec.error) continue;
    out.set(String(rec.url).replace(/\/$/, ""), rec);
  }
  return out;
}

async function main() {
  const conn = await connectMongo();
  const brand = await conn.db.collection("brands").findOne({ name: /^tile mountain$/i });
  if (!brand) throw new Error("Tile Mountain brand not found");
  const sec = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
    .asPromise();
  const P = sec.db.collection("products");

  const capture = readCapture();
  const docs = await P.find({ brand: brand._id })
    .project({
      _id: 1,
      name: 1,
      price: 1,
      stock: 1,
      description: 1,
      features: 1,
      rangeName: 1,
      downloads: 1,
      swatchGroups: 1,
      reviewSummary: 1,
      "specs.sourceUrl": 1,
    })
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .toArray();

  console.log("brand   : " + brand.name + "  (" + brand.dataCluster + ")");
  console.log(
    "capture : " + capture.size + "   db: " + docs.length + (DRY_RUN ? "   (DRY RUN)" : ""),
  );
  console.log("stock   : " + (WITH_STOCK ? "taken from the site" : "left as stored"));
  console.log("");

  const tally = {
    matched: 0,
    unmatched: 0,
    description: 0,
    features: 0,
    range: 0,
    datasheet: 0,
    maintenance: 0,
    reviews: 0,
    samples: 0,
    swatches: 0,
    stockDown: 0,
    stockUp: 0,
  };
  const ops = [];

  for (const d of docs) {
    const url = clean(d.specs && d.specs.sourceUrl).replace(/\/$/, "");
    const rec = url && capture.get(url);
    if (!rec) {
      tally.unmatched += 1;
      continue;
    }
    tally.matched += 1;
    const p = rec.product;
    const slug = clean(p.url_key) || url.split("/").pop();
    const set = {};

    /* Their slug is the handle the swatch row links siblings by. */
    set["specs.plankHandle"] = slug;
    set["specs.tmSku"] = clean(p.sku);

    const desc = clean(p.product_description && p.product_description.html);
    if (desc && desc.length > clean(d.description).length) {
      set.description = desc;
      tally.description += 1;
    }

    const feats = featuresFrom(p.key_features);
    if (feats.length > (d.features || []).length) {
      set.features = feats;
      tally.features += 1;
    }

    const range = clean(p.primary_range);
    if (range && range !== clean(d.rangeName)) {
      set.rangeName = range;
      tally.range += 1;
    }

    const files = downloadsFrom(p.datasheet_v2);
    if (files.length) {
      const have = new Set((d.downloads || []).map((x) => clean(x.sourceUrl || x.url)));
      const add = files.filter((f) => !have.has(f.sourceUrl));
      if (add.length) {
        set.downloads = [...(d.downloads || []), ...add];
        tally.datasheet += 1;
      }
    }

    const care = clean(p.cleaning_and_maintenance);
    if (care) {
      set["maintenance.html"] = care;
      tally.maintenance += 1;
    }

    const rating = Number(p.average_score);
    const count = Number(p.total_reviews);
    if (Number.isFinite(rating) && rating > 0 && Number.isFinite(count) && count > 0) {
      set["reviewSummary.rating"] = Math.round(rating * 100) / 100;
      set["reviewSummary.count"] = count;
      set["reviewSummary.source"] = "tilemountain";
      tally.reviews += 1;
    }

    if (clean(p.samples_status) === "1") {
      set.sampleAvailable = true;
      const loc = clean(p.cut_sample_location);
      if (loc) set.sampleSku = loc;
      let opts = null;
      try {
        opts = JSON.parse(p.sample_options || "null");
      } catch {}
      const first = Array.isArray(opts) ? opts[0] : null;
      if (first) {
        const sp = Number(first.sample_price);
        if (Number.isFinite(sp) && sp > 0) set["specs.samplePrice"] = sp;
        if (clean(first.sample_type)) set["specs.sampleType"] = clean(first.sample_type);
      }
      tally.samples += 1;
    }

    const groups = swatchesFrom(p, slug);
    if (RESWATCH) {
      // Rebuild outright, so a row that should no longer be there goes.
      set.swatchGroups = groups;
      if (groups.length) tally.swatches += 1;
    } else if (groups.length && !(d.swatchGroups || []).length) {
      set.swatchGroups = groups;
      tally.swatches += 1;
    }

    if (clean(p.stock_level_text)) set["specs.stockLevelText"] = clean(p.stock_level_text);
    if (WITH_STOCK) {
      const qty = Number(p.getStockInformation && p.getStockInformation.qty);
      const live = Number.isFinite(qty) ? Math.max(0, qty) : null;
      if (live != null && live !== Number(d.stock)) {
        set.stock = live;
        if (live < Number(d.stock)) tally.stockDown += 1;
        else tally.stockUp += 1;
      }
    }

    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
    }
  }

  console.log("matched           : " + tally.matched + "   (no capture: " + tally.unmatched + ")");
  console.log("fuller description: " + tally.description);
  console.log("more key features : " + tally.features);
  console.log("range name        : " + tally.range);
  console.log("datasheet PDF     : " + tally.datasheet);
  console.log("cleaning & care   : " + tally.maintenance);
  console.log("review score      : " + tally.reviews);
  console.log("sample orderable  : " + tally.samples);
  console.log("colourway swatches: " + tally.swatches);
  if (WITH_STOCK) console.log("stock  up/down    : " + tally.stockUp + " / " + tally.stockDown);
  console.log("products to write : " + ops.length);
  console.log("");

  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 500) {
      await P.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    console.log("written : " + ops.length);
  } else {
    console.log("dry run : nothing written");
  }

  await mongoose.disconnect();
  await sec.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
