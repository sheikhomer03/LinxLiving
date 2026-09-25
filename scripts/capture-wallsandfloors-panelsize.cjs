/**
 * Captures the "Panel Size" button selector (distinct from both the
 * colour swatch and the plain "100x100mm"-style size buttons already
 * handled) — some Trepanel ranges expose a genuine size switcher with
 * friendly labels ("XXL Panel" / "Half Panel") instead of raw
 * dimensions, e.g. trepanel-aqua-luxe-ivory-stone-effect-spc-wall-panel
 * (Half Panel, 1184x592mm) <-> ...-spc-xxl-wall-panel (XXL Panel,
 * 2600x900mm). Missed entirely by the earlier colour-only sibling pass.
 *
 * Not every product with a "Panel Size" label has buttons under it —
 * many just show the dimension as plain text (no switcher, genuinely no
 * size sibling) — confirmed on Gloss Ivory Travertine. Only products
 * with 2+ actual buttons are real families.
 *
 * Same grouping technique proven safe for colour (exact label-set match
 * + first-word-of-name, NOT the generic "100x100mm"-only size grouping
 * that caused real false positives — these labels are descriptive/
 * branded ("XXL Panel"), not generic dimensions shared across unrelated
 * ranges).
 *
 * Env: FRESH=1, LIMIT=n, DRY_RUN=1
 */
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", ".scratch", "wallsandfloors");
const CHECKPOINT_FILE = path.join(DATA_DIR, "wf-panelsize-raw.jsonl");
const FRESH = process.env.FRESH === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";

fs.mkdirSync(DATA_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function get(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " on " + url);
    return await res.text();
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1200 * Math.pow(2, attempt)));
    return get(url, attempt + 1);
  }
}

/** Returns { labels, ownLabel } — ownLabel is whichever button carries the
 *  "...backgroundActive..." class, i.e. the label for the product whose
 *  OWN page this is (confirmed via the CSS class marker, not guessed). */
function parsePanelSizeLabels(html) {
  const idx = html.indexOf("Panel Size");
  if (idx === -1) return { labels: [], ownLabel: "" };
  // Bounded to the text between THIS attribute's closing </p> and the
  // NEXT attribute paragraph's own opening <p> — a product with no real
  // switcher (just a plain-text dimension) has no button div in that
  // span at all, and the naive "next <div> anywhere" search instead
  // picked up the FOLLOWING attribute's button group (e.g. Finish:
  // Gloss/Matt) as if it were Panel Size's — confirmed real bug on
  // Gloss Ivory Travertine, which has no Panel Size switcher.
  const afterP = html.indexOf("</p>", idx);
  if (afterP === -1) return { labels: [], ownLabel: "" };
  const nextP = html.indexOf("<p ", afterP + 4);
  const nextP2 = html.indexOf("<p>", afterP + 4);
  const boundary = [nextP, nextP2].filter((n) => n !== -1).sort((a, b) => a - b)[0] ?? afterP + 800;
  const span = html.slice(afterP, boundary);
  if (!span.includes("<button")) return { labels: [], ownLabel: "" };

  const buttons = [...span.matchAll(/<button\b[^]*?<\/button>/g)].map((m) => m[0]);
  const labels = [];
  let ownLabel = "";
  for (const btn of buttons) {
    const labelMatch = /<!--\[-->([A-Za-z0-9 ]{1,24})<!--\]-->/.exec(btn);
    if (!labelMatch) continue;
    const label = labelMatch[1].trim();
    labels.push(label);
    if (btn.includes("backgroundActive")) ownLabel = label;
  }
  return { labels: [...new Set(labels)].length >= 2 ? [...new Set(labels)] : [], ownLabel };
}

function familyKey(list) {
  if (!Array.isArray(list) || list.length < 2) return null;
  return [...list].map((s) => String(s).trim().toLowerCase()).sort().join("|");
}
function firstWord(name) {
  return String(name || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
}

async function fetchPanelSizeData() {
  const capFile = path.join(DATA_DIR, "wf-pdp.jsonl");
  const allRecs = fs.readFileSync(capFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  console.log("catalogue size:", allRecs.length);

  const already = new Map();
  if (!FRESH && fs.existsSync(CHECKPOINT_FILE)) {
    for (const line of fs.readFileSync(CHECKPOINT_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); already.set(r.url, r); } catch {}
    }
  }
  console.log("already captured:", already.size);

  const out = fs.createWriteStream(CHECKPOINT_FILE, { flags: FRESH ? "w" : "a" });
  let done = 0, errors = 0, withLabels = 0;
  const started = Date.now();

  for (const rec of allRecs) {
    if (done >= LIMIT) break;
    if (already.has(rec.url)) continue;
    done += 1;
    try {
      const html = await get(rec.url);
      const { labels, ownLabel } = parsePanelSizeLabels(html);
      if (labels.length) withLabels++;
      out.write(JSON.stringify({ url: rec.url, panelSizeLabels: labels, ownLabel }) + "\n");
    } catch (e) {
      errors += 1;
      out.write(JSON.stringify({ url: rec.url, error: String(e.message || e) }) + "\n");
    }
    if (done % 100 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((allRecs.length - already.size - done) / Math.max(rate, 0.001) / 60);
      console.log("  " + done + " checked, " + withLabels + " with panel-size buttons, " + errors + " errors, ~" + left + "m left");
    }
  }
  out.end();
  console.log("done fetching. checked " + done + " this run, " + withLabels + " with labels, " + errors + " errors");
}

async function linkSiblings() {
  const mongoose = require("mongoose");
  for (const f of [".env.local", ".env"]) {
    const p = path.join(__dirname, "..", f);
    if (fs.existsSync(p)) require("dotenv").config({ path: p });
  }
  const { connectMongo } = require("./mongo-connect.cjs");

  const rawRecs = fs.readFileSync(CHECKPOINT_FILE, "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const pdpRecs = fs.readFileSync(path.join(DATA_DIR, "wf-pdp.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const nameByUrl = new Map(pdpRecs.map((r) => [r.url, r.name]));

  const families = new Map();
  for (const r of rawRecs) {
    const ck = familyKey(r.panelSizeLabels);
    if (!ck) continue;
    const key = firstWord(nameByUrl.get(r.url)) + "||" + ck;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(r.url);
  }
  console.log("distinct panel-size families (2+ members):", families.size);
  for (const [k, v] of families) console.log("  " + k + "  (" + v.length + " members)");

  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ name: "Walls and Floors" });
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  const col = conn.db.collection("products");

  const docs = await col.find({ brand: brand._id }).project({ sourceUrl: 1, name: 1, price: 1, images: 1, specs: 1 }).toArray();
  const byUrl = new Map(docs.map((d) => [d.sourceUrl, d]));

  function summarize(doc, panelSizeLabel) {
    return {
      id: String(doc._id),
      name: doc.name,
      colour: doc.specs?.["Product color"] || "",
      size: doc.specs?.Size || "",
      sizeLabel: panelSizeLabel || "",
      price: doc.price,
      image: (doc.images || [])[0] || "",
    };
  }

  const rawByUrl = new Map(rawRecs.map((r) => [r.url, r]));
  const ops = [];
  let touched = 0, totalNewEdges = 0;

  for (const r of rawRecs) {
    const doc = byUrl.get(r.url);
    if (!doc) continue;
    const ck = familyKey(r.panelSizeLabels);
    if (!ck) continue;
    const key = firstWord(nameByUrl.get(r.url)) + "||" + ck;
    const siblingUrls = (families.get(key) || []).filter((u) => u !== r.url);
    if (!siblingUrls.length) continue;

    const existing = doc.specs?.variantSiblings || [];
    
    // We want to merge existing siblings with the new ones, giving preference to the new ones which contain sizeLabel.
    const newSiblings = siblingUrls
      .map((su) => {
        const sDoc = byUrl.get(su);
        const sRaw = rawByUrl.get(su);
        if (!sDoc || !sRaw) return null;
        return summarize(sDoc, sRaw.ownLabel);
      })
      .filter(Boolean);

    // Create a merged array
    const mergedMap = new Map();
    existing.forEach(s => mergedMap.set(s.id, s));
    newSiblings.forEach(s => mergedMap.set(s.id, s)); // Overwrite with new rich data
    
    const finalSiblings = [...mergedMap.values()];

    touched++;
    totalNewEdges += newSiblings.length;
    ops.push({
      updateOne: {
        filter: { _id: doc._id, brand: brand._id },
        update: { $set: { "specs.variantSiblings": finalSiblings, "specs.panelSizeLabel": r.ownLabel || "" } },
      },
    });
  }

  console.log("products getting NEW panel-size siblings:", touched, " new edges:", totalNewEdges);
  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 300) {
      await col.bulkWrite(ops.slice(i, i + 300), { ordered: false });
    }
    console.log("done.");
  } else if (DRY_RUN) {
    console.log("[dry run — nothing written]");
  }
  await conn.close();
}

async function main() {
  await fetchPanelSizeData();
  await linkSiblings();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
