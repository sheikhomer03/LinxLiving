/**
 * Rebuild the name and option labels of merged products from their variants.
 *
 * merge-variants-brands.cjs named each merged product by deleting sizes and a
 * fixed list of colour words from one member's title, and labelled each
 * variant with the first size-looking token it found. "Crash Blue Matt 30cm x
 * 60cm Wall & Floor Tile" came out as "Crash X Wall & Floor Tile" with a Size
 * of "30cm" — the "x 60cm" lost — so a 30x30 and a 30x60 collided and one was
 * relabelled "30cm (Alt MERGED-V2)".
 *
 * Every variant still carries its original product's full title in `name`.
 * The words all of them share, in order, are the product; the words that
 * differ are the option. A dimension ("30cm x 60cm", "600x1200mm", "10mm")
 * becomes Size and whatever else differs becomes Colour/Finish.
 *
 * A product whose variants all have the same title (merge-size-variants.cjs
 * built those from `specs.Size`) keeps the labels it has.
 *
 *   node scripts/fix-merged-product-options.cjs              # dry run
 *   node scripts/fix-merged-product-options.cjs --apply      # write (backs up first)
 *   node scripts/fix-merged-product-options.cjs --id=<id>
 */
require("dotenv").config({ path: ".env.local" });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));

const fs = require("fs");
const path = require("path");
const { MongoClient, BSON } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const ONLY_ID = (process.argv.find((a) => a.startsWith("--id=")) || "").slice(5);
const REPORT_IN = process.argv.find((a) => a.startsWith("--report="))?.slice(9) ||
  path.join(__dirname, "../backups/merged-image-restore-report-2026-09-26T10-00-23-274Z.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(__dirname, `../backups/merged-options-fix-report-${STAMP}.json`);

const UNIT = "(?:(?:mm|cm|m|ft|in)(?![a-z])|[\"'])";
const NUM = "\\d+(?:[.,]\\d+)?";
/** "30cm x 60cm", "600 x 1200mm", "60x120", "2.4m", "10mm", "6ft" */
const DIMENSION = new RegExp(
  `(?:${NUM}(?:\\s*${UNIT})?\\s*[xX×]\\s*)+${NUM}(?:\\s*${UNIT})?|${NUM}\\s*${UNIT}`,
  "gi",
);

/** Words, with each dimension ("30cm x 60cm") held together as one. */
const tokens = (s) =>
  String(s || "")
    .replace(DIMENSION, (m) => m.replace(/\s+/g, "\u0001"))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/\u0001/g, " "));
const fixCase = (w) => (/^[A-Z]{3,}$/.test(w) && !/^(LVT|LED|SPC|MDF|PVC|UK|WPC|UPVC|BCT|RLV|AICA|LTP|RAK|FAKRO|GRP|UV|XL|XXL|WC|PIR|USB)$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w);
const tidy = (s) =>
  String(s || "")
    .replace(/\s+([,)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/(\s[-–—|])+\s*$/g, "")
    .replace(/^\s*[-–—|,]\s*/, "")
    .replace(/\s[-–—]\s[-–—]\s/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Common leading and trailing words of every title; the rest differs. */
function splitTitles(titles) {
  const lists = titles.map(tokens);
  const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
  let pre = 0;
  while (lists.every((l) => pre < l.length && eq(l[pre], lists[0][pre]))) pre++;
  let suf = 0;
  while (
    lists.every((l) => suf < l.length - pre && eq(l[l.length - 1 - suf], lists[0][lists[0].length - 1 - suf]))
  )
    suf++;
  const first = lists[0];
  const base = tidy([...first.slice(0, pre), ...first.slice(first.length - suf)].join(" "));
  const diffs = lists.map((l) => l.slice(pre, l.length - suf).join(" "));
  return { base, diffs };
}

function labelParts(diff) {
  const sizes = String(diff).match(DIMENSION) || [];
  const size = sizes.map((s) => s.replace(/\s+/g, " ").trim()).join(" ");
  const rest = tidy(String(diff).replace(DIMENSION, " ").replace(/\s[-–—]\s/g, " ").replace(/[()]/g, " "));
  return { size, finish: rest };
}

/**
 * Products whose titles cannot tell the variants apart, settled by hand from
 * the originals in the 2026-09-24 backup. `null` drops a row that duplicated
 * another listing of the same item (same size, finish and price).
 */
const OVERRIDES = {
  // Rows 3 and 4 are one tile the supplier lists twice (p12751, p12345).
  "6ab2663e89e24d150e85f0c6": {
    name: "Flat Glossy Wall Tile",
    axes: ["Size", "Colour/Finish"],
    labels: [["10cm x 20cm", "Yellow"], ["20cm x 20cm", "White"], ["20cm x 25cm", "White"], null],
  },
  // Two identical listings (p8903, p8906): same title, price and nothing else.
  "6ab2664189e24d150e85f435": { name: "Pearl Sparkle Glitter Additive For Grout And Paint 100g", axes: [], labels: [[], null] },
  "6ab3b88553747b87fb8389e3": { name: "Country Farmhouse Black Slate Tiles", axes: ["Size"], labels: [["300x300x7mm"], ["600x400x8mm"]] },
  "6ab3b88553747b87fb8389f4": { name: "LTP Mattstone Tile Sealer", axes: ["Size"], labels: [["1 litre"], ["5 litre"]] },
  "6ab795cc731d71b136a76cf2": { axes: ["Colour"], labels: [["White"], ["Grey"]] },
  // Awaiting a decision — labelled so the two rows can at least be told apart.
  "6ab3bcf8cdb5ecac624e1aae": { name: "LTP Porcelain Tile Protector", axes: ["Option"], labels: [["Total Tiles"], ["1 Litre"]] },
  "6ab6487afcfdbfee1ebb4c7e": { axes: ["Option"], labels: [["DS252"], ["DS253"]] },
  "6ab64883fcfdbfee1ebb4c82": { axes: ["Option"], labels: [["DRWN1A"], ["DRWN1D"]] },
};

function applyOverride(doc, o) {
  const keep = doc.variants.map((v, i) => [v, o.labels[i]]).filter(([, l]) => l);
  const trimmed = { ...doc, variants: keep.map(([v]) => v) };
  const base = o.name || doc.name;
  if (!o.axes.length) {
    const variants = trimmed.variants.map((v) => {
      const next = { ...v, options: {} };
      delete next.option1;
      delete next.option2;
      return next;
    });
    return { name: base, variants, shopifyOptions: [], dropped: doc.variants.length - keep.length };
  }
  return { ...finalize(trimmed, base, o.axes, keep.map(([, l]) => l)), dropped: doc.variants.length - keep.length };
}

function rebuild(doc) {
  const override = OVERRIDES[String(doc._id)];
  if (override) return applyOverride(doc, override);
  const vs = doc.variants || [];
  const titles = vs.map((v) => String(v.name || "").trim());
  if (titles.some((t) => !t)) return { skip: "variant without a title" };
  if (new Set(titles.map((t) => t.toLowerCase())).size === 1) return { skip: "variants share one title" };

  let { base, diffs } = splitTitles(titles);
  if (!base || tokens(base).length < 2) {
    // The words are in a different order from one title to the next
    // ("Fargo White Matt Stone…" / "Fargo Stone… Grey"): compare them as sets.
    const lists = titles.map((t) => tokens(t.replace(/-/g, " ")));
    const inAll = (w) => lists.every((l) => l.some((x) => x.toLowerCase() === w.toLowerCase()));
    base = tidy(lists[0].filter(inAll).join(" "));
    diffs = lists.map((l) => l.filter((w) => !inAll(w)).join(" "));
    if (tokens(base).length < 2) return { skip: `no usable common name ("${base}")` };
  }
  const parts = diffs.map(labelParts);
  // A finish word every variant shares ("Bevel", "Gloss") describes the
  // product, not the choice: it moves into the name.
  const finishWords = parts.map((p) => tokens(p.finish));
  const shared = finishWords[0].filter((w) =>
    finishWords.every((l) => l.some((x) => x.toLowerCase() === w.toLowerCase())),
  );
  if (shared.length && finishWords.every((l) => l.length > shared.length)) {
    const drop = new Set(shared.map((w) => w.toLowerCase()));
    parts.forEach((p, i) => (p.finish = finishWords[i].filter((w) => !drop.has(w.toLowerCase())).join(" ")));
    const baseWords = tokens(base);
    const at = tokens(titles[0]).findIndex((w, i, all) => i >= 0 && !baseWords.includes(w));
    baseWords.splice(Math.max(0, Math.min(at, baseWords.length)), 0, ...shared);
    base = tidy(baseWords.join(" "));
  }
  parts.forEach((p) => (p.finish = tokens(p.finish).map(fixCase).join(" ")));
  const sizeVaries = new Set(parts.map((p) => p.size.toLowerCase())).size > 1;
  const finishVaries = new Set(parts.map((p) => p.finish.toLowerCase())).size > 1;

  const axes = [];
  if (sizeVaries) axes.push("Size");
  if (finishVaries) axes.push("Colour/Finish");
  if (!axes.length) return { skip: "differences could not be told apart" };

  const valueOf = (p, axis) =>
    axis === "Size" ? p.size || "Standard" : p.finish || "Standard";
  const labels = parts.map((p) => axes.map((a) => valueOf(p, a)));
  const keys = labels.map((l) => l.join(" / ").toLowerCase());
  if (new Set(keys).size !== keys.length) {
    // Same size and finish on two rows — show the whole differing text instead.
    const whole = diffs.map((d) => tidy(d) || "Standard");
    if (new Set(whole.map((w) => w.toLowerCase())).size !== whole.length) {
      return { skip: "two variants are indistinguishable", labels: whole };
    }
    return finalize(doc, base, ["Option"], whole.map((w) => [w]));
  }
  return finalize(doc, base, axes, labels);
}

function finalize(doc, base, axes, labels) {
  const variants = doc.variants.map((v, i) => {
    const options = {};
    axes.forEach((a, j) => (options[a] = labels[i][j]));
    const next = { ...v, options, option1: labels[i][0] };
    if (axes[1]) next.option2 = labels[i][1];
    else delete next.option2;
    return next;
  });
  const shopifyOptions = axes.map((name, j) => ({
    name,
    values: [...new Set(labels.map((l) => l[j]))],
  }));
  return { name: tokens(base).map(fixCase).join(" "), variants, shopifyOptions };
}

async function main() {
  const ids = ONLY_ID
    ? [ONLY_ID]
    : JSON.parse(fs.readFileSync(REPORT_IN, "utf8")).products.filter((p) => !p.skipped).map((p) => p.id);
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const col = client.db("test").collection("products");
  const docs = await col.find({ _id: { $in: ids.map((i) => new BSON.ObjectId(i)) } }).toArray();

  const report = { mode: APPLY ? "apply" : "dry-run", changed: [], skipped: [] };
  const backup = [];
  for (const doc of docs) {
    const r = rebuild(doc);
    const oldLabels = doc.variants.map((v) => [v.option1, v.option2].filter(Boolean).join(" / "));
    if (r.skip) {
      report.skipped.push({ id: String(doc._id), name: doc.name, reason: r.skip, labels: r.labels || oldLabels });
      continue;
    }
    const newLabels = r.variants.map((v) => [v.option1, v.option2].filter(Boolean).join(" / "));
    if (r.dropped) oldLabels.push(`(${r.dropped} duplicate row removed)`);
    if (r.name === doc.name && JSON.stringify(newLabels) === JSON.stringify(oldLabels)) continue;
    report.changed.push({
      id: String(doc._id),
      before: doc.name,
      after: r.name,
      options: r.shopifyOptions.map((o) => o.name).join(" + "),
      labels: oldLabels.map((o, i) => `${o}  →  ${newLabels[i]}`),
    });
    if (APPLY) {
      backup.push(BSON.EJSON.stringify({ cluster: "secondary", doc }, { relaxed: false }));
      await col.updateOne(
        { _id: doc._id },
        { $set: { name: r.name, variants: r.variants, shopifyOptions: r.shopifyOptions } },
      );
    }
  }
  if (APPLY && backup.length) {
    const undo = path.join(__dirname, `../backups/pre-options-fix-${STAMP}.ejson`);
    fs.writeFileSync(undo, backup.join("\n") + "\n");
    console.log(`Previous versions of ${backup.length} products saved to ${undo}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log({ checked: docs.length, changed: report.changed.length, skipped: report.skipped.length });
  console.log(`Report: ${OUT}`);
  if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply to save.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
