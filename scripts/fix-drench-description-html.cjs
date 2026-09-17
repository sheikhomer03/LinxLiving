/**
 * Close the unbalanced tags in scraped Drench descriptions.
 *
 * `capture-drench.cjs` used to end an accordion body at the first
 * `</div></div>`, which with nested content stopped early and left the wrapper
 * divs open. React renders the string as-is on the server while the browser
 * repairs it on parse, so the two trees disagree and the product page throws a
 * hydration error.
 *
 * The repair only ever APPENDS the closing tags a document is missing, in the
 * reverse order they were opened. No content is altered, nothing is removed,
 * and a well-formed description is left untouched.
 *
 * Writes a rollback file before changing anything.
 *
 * Env:
 *   DRY_RUN=1   report only
 *   LIMIT=n     cap the number repaired
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const BRAND_SLUG = "drench";

/** Elements that never take a closing tag. */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Tags left open at the end of the string, outermost first.
 * A stray closer with nothing to match is ignored rather than trusted.
 */
function unclosedStack(html) {
  const stack = [];
  for (const m of String(html || "").matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const selfClosed = m[3] === "/";
    if (VOID.has(tag) || selfClosed) continue;
    if (!closing) { stack.push(tag); continue; }
    const at = stack.lastIndexOf(tag);
    if (at !== -1) stack.splice(at, 1);
  }
  return stack;
}

function repair(html) {
  const stack = unclosedStack(html);
  if (!stack.length) return null;
  const closers = stack.slice().reverse().map((t) => "</" + t + ">").join("");
  return { fixed: String(html) + closers, added: stack.slice().reverse() };
}

async function main() {
  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  const P = db.collection("products");
  const total = await P.countDocuments({ brand: brand._id });
  console.log(BRAND_SLUG + " products: " + total + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  const rollback = [];
  const ops = [];
  let scanned = 0, broken = 0, repaired = 0;
  const addedCounts = new Map();
  let lastId = null;

  for (;;) {
    if (repaired >= LIMIT) break;
    const q = { brand: brand._id };
    if (lastId) q._id = { $gt: lastId };
    const page = await P.find(q)
      .project({ description: 1 })
      .sort({ _id: 1 })
      .limit(500)
      .toArray();
    if (!page.length) break;

    for (const p of page) {
      lastId = p._id;
      scanned += 1;
      const d = String(p.description || "");
      if (!d.trim()) continue;
      const r = repair(d);
      if (!r) continue;
      broken += 1;
      if (repaired >= LIMIT) continue;

      const key = r.added.join("");
      addedCounts.set(key, (addedCounts.get(key) || 0) + 1);
      rollback.push({ _id: String(p._id), description: d });
      ops.push({
        updateOne: { filter: { _id: p._id }, update: { $set: { description: r.fixed } } },
      });
      repaired += 1;
    }

    if (!DRY_RUN && ops.length >= 500) {
      await P.bulkWrite(ops.splice(0, ops.length), { ordered: false });
    }
    if (scanned % 2000 < 500) {
      console.log("  scanned " + scanned + "/" + total + "  unbalanced " + broken);
    }
  }

  if (!DRY_RUN && ops.length) await P.bulkWrite(ops, { ordered: false });

  if (!DRY_RUN && rollback.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(__dirname, "..", "rollback-drench-description-html-" + stamp + ".json");
    fs.writeFileSync(file, JSON.stringify(rollback));
    console.log("");
    console.log("rollback written: " + path.basename(file) + "  (" + rollback.length + " documents)");
  }

  console.log("");
  console.log((DRY_RUN ? "[dry] " : "") + "scanned " + scanned +
    ", unbalanced " + broken + ", repaired " + repaired);
  console.log("");
  console.log("closing tags appended:");
  for (const [k, v] of [...addedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log("  " + (k || "(none)").padEnd(26) + v + " products");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
