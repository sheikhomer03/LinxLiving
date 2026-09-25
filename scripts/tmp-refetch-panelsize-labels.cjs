const path = require("path");
const fs = require("fs");
const DATA_DIR = path.join(__dirname, "..", ".scratch", "wallsandfloors");
const mod = fs.readFileSync(path.join(__dirname, "capture-wallsandfloors-panelsize.cjs"), "utf8");
eval(mod.replace(/^main\(\).*$/m, ""));

async function run() {
  const raw = fs.readFileSync(path.join(DATA_DIR, "wf-panelsize-raw.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const targets = raw.filter((r) => (r.panelSizeLabels || []).length >= 2);
  console.log("re-fetching", targets.length, "products with real labels");

  const out = [];
  for (const t of targets) {
    const html = await get(t.url);
    const { labels, ownLabel } = parsePanelSizeLabels(html);
    out.push({ url: t.url, panelSizeLabels: labels, ownLabel });
    console.log(" ", t.url.split("/").pop(), "->", ownLabel, labels);
  }

  // merge back into the full raw file: replace matching URLs, keep the rest
  const byUrl = new Map(raw.map((r) => [r.url, r]));
  for (const o of out) byUrl.set(o.url, o);
  fs.writeFileSync(
    path.join(DATA_DIR, "wf-panelsize-raw.jsonl"),
    [...byUrl.values()].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  console.log("done, file updated");
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
