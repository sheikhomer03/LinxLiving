/**
 * Verify the built Bathdisc catalogue (bathdisc-final.json) against the live
 * site. Read-only: fetches bathdisc.co.uk product JSON and image URLs.
 *
 *  - prices: random variants re-fetched live → price and was-price must match
 *  - families: every member of random merged families checked on its own page
 *  - images: random image URLs must return an image
 *
 *   node scripts/bathdisc-verify.cjs [--prices=150] [--families=30] [--images=200]
 */
const fs = require("fs");
const path = require("path");

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1]) || d;
const L = JSON.parse(fs.readFileSync(path.join(__dirname, "../.scratch/bathdisc/v2/bathdisc-final.json"), "utf8"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sample = (arr, n) => [...arr].sort(() => rand() - 0.5).slice(0, n);

const cache = new Map();
async function live(handle) {
  if (cache.has(handle)) return cache.get(handle);
  const res = await fetch(`https://www.bathdisc.co.uk/products/${handle}.js`, { headers: { "User-Agent": UA } });
  const j = res.ok ? await res.json() : null;
  cache.set(handle, j);
  await delay(250);
  return j;
}
const handleOf = (url) => url.split("/products/")[1].split("?")[0];
const idOf = (url) => (url.match(/variant=(\d+)/) || [])[1];

async function checkVariant(listing, v) {
  const j = await live(handleOf(v.sourceUrl));
  if (!j) return `${listing.name} / ${v.name}: page not found live`;
  const lv = (j.variants || []).find((x) => String(x.id) === (idOf(v.sourceUrl) || v.externalId)) || (j.variants || []).find((x) => x.sku && x.sku === v.sku);
  if (!lv) return `${listing.name} / ${v.name}: variant not on live page`;
  const price = lv.price / 100;
  const cmp = lv.compare_at_price ? lv.compare_at_price / 100 : null;
  const wantCmp = cmp && cmp > price ? cmp : null;
  if (Math.abs(price - v.price) > 0.005) return `${listing.name} / ${v.name}: price ours £${v.price} vs live £${price}`;
  if ((wantCmp || null) !== (v.compareAtPrice || null) && Math.abs((wantCmp || 0) - (v.compareAtPrice || 0)) > 0.005) return `${listing.name} / ${v.name}: was ours £${v.compareAtPrice} vs live £${wantCmp}`;
  return null;
}

async function main() {
  const out = { prices: { checked: 0, problems: [] }, families: { checked: 0, variants: 0, problems: [] }, images: { checked: 0, problems: [] } };

  const allVariants = L.flatMap((l) => l.variants.map((v) => [l, v]));
  for (const [l, v] of sample(allVariants, arg("prices", 150))) {
    const p = await checkVariant(l, v);
    out.prices.checked++;
    if (p) out.prices.problems.push(p);
    if (out.prices.checked % 25 === 0) console.error(`progress: prices ${out.prices.checked} checked, ${out.prices.problems.length} problems`);
  }

  for (const l of sample(L.filter((x) => x.sourceType === "merged-family"), arg("families", 30))) {
    out.families.checked++;
    if (out.families.checked % 10 === 0) console.error(`progress: families ${out.families.checked} checked, ${out.families.problems.length} problems`);
    for (const v of l.variants) {
      out.families.variants++;
      const j = await live(handleOf(v.sourceUrl));
      const lv = j && (j.variants || []).find((x) => (v.sku && x.sku === v.sku) || String(x.id) === v.externalId);
      if (!lv) out.families.problems.push(`${l.name} / ${v.name}: not found live`);
      else if (Math.abs(lv.price / 100 - v.price) > 0.005) out.families.problems.push(`${l.name} / ${v.name}: ours £${v.price} vs live £${lv.price / 100}`);
    }
  }

  const imgs = [...new Set(L.flatMap((l) => [...l.images, ...l.variants.map((v) => v.imageUrl)]).filter(Boolean))];
  for (const u of sample(imgs, arg("images", 200))) {
    out.images.checked++;
    if (out.images.checked % 50 === 0) console.error(`progress: images ${out.images.checked} checked, ${out.images.problems.length} problems`);
    try {
      const res = await fetch(u, { method: "HEAD", headers: { "User-Agent": UA } });
      if (!res.ok || !/image\//.test(res.headers.get("content-type") || "")) out.images.problems.push(`${res.status} ${res.headers.get("content-type")} ${u}`);
    } catch (e) { out.images.problems.push(`ERR ${u}`); }
  }
  out.images.totalDistinct = imgs.length;
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
