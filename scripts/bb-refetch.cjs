/**
 * Re-fetch only the Better Bathrooms pages the build could not settle
 * (work/bb-confusions.json): pages with no product data, no price, or whose
 * colour/size could not be told apart. For each page it records what the first
 * capture threw away — Better Bathrooms' own ProductGroup (which pages are one
 * product), the option value selected on this page for each selector, and the
 * breadcrumb — plus fresh product data and price. Sibling pages named in a
 * ProductGroup that we have never seen are fetched too, so a group is complete.
 *
 * Read-only against betterbathrooms.com; writes work/bb-refetch.jsonl.
 * Resumable: pages already in the output are skipped.
 *
 *   node scripts/bb-refetch.cjs [--limit=N]
 */
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const DIR = path.join(__dirname, "../.scratch/betterbathrooms");
const WORK = path.join(DIR, "work");
const OUT = path.join(WORK, "bb-refetch.jsonl");
const ORIGIN = "https://www.betterbathrooms.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const CONCURRENCY = 4;
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").slice(8)) || Infinity;

const pathKey = (u) => {
  let p = String(u || "").split("#")[0].split("?")[0].replace(ORIGIN, "");
  if (!p.startsWith("/")) p = "/" + p;
  return p.toLowerCase();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (s) => String(s || "").replace(/\s+/g, " ").trim();

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { status: res.status, html: await res.text(), finalUrl: res.url };
    } catch (e) {
      if (i === tries) return { error: e.message };
      await sleep(1500 * i);
    }
  }
}

function parseLd(raw) {
  try { return JSON.parse(raw); } catch {}
  // Better Bathrooms emits raw line breaks and tabs inside strings
  try { return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ")); } catch {}
  // …and on some pages a colour-swatch block missing commas between keys
  const repaired = raw
    .replace(/("(?:[^"\\\n]|\\.)*"|\d|true|false|null|[}\]])(\s*\n\s*)(?="[\w@]+"\s*:)/g, "$1,$2")
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/[\u0000-\u001f]+/g, " ");
  try { return JSON.parse(repaired); } catch {}
  return null;
}

function extract(html, url) {
  const $ = cheerio.load(html);
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const v = parseLd($(el).html() || "");
    if (!v) return;
    for (const b of Array.isArray(v) ? v : v["@graph"] || [v]) blocks.push(b);
  });
  const product = blocks.find((b) => b["@type"] === "Product" && b.name);
  const group = blocks.find((b) => b["@type"] === "ProductGroup");
  const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");

  // option value selected on this page, per selector heading
  const selected = {};
  $(".ProductVariantsList").each((_, el) => {
    const axis = text($(el).find("h5").first().text());
    if (!axis) return;
    let value = "";
    $(el).find("option").each((_, o) => {
      if ($(o).attr("selected") !== undefined) value = text($(o).attr("title") || $(o).clone().children().remove().end().text());
    });
    if (!value) {
      $(el).find("li, .variation-swatch, .image_thumb, a, div").each((_, s) => {
        if (value) return;
        const own = $(s);
        const isSel = /\bselected(Thumb)?\b/i.test(own.attr("class") || "") || /^\s*selected\s*$/i.test(text(own.find(".showVariantPrice").first().text()));
        if (!isSel) return;
        value = text(own.find("span").first().text()) || text(own.attr("title")) || text(own.find("img").attr("alt"));
      });
    }
    if (value) selected[axis] = value.replace(/\s*\|\s*selected$/i, "");
  });

  // specification table (label → value); icons become Yes / No
  const tableSpecs = {};
  $("span.Header").each((_, h) => {
    const label = text($(h).text());
    const cell = $(h).closest("td").next("td");
    let value = text(cell.text());
    if (!value) {
      if (cell.find(".fa-xmark, .fa-times").length) value = "No";
      else if (cell.find(".fa-check, .fa-circle-check").length) value = "Yes";
    }
    if (label) tableSpecs[label] = value;
  });

  const offers = product && (Array.isArray(product.offers) ? product.offers[0] : product.offers);
  let price = Number(offers?.price || offers?.lowPrice) || 0;
  if (!price && group?.hasVariant) {
    const me = group.hasVariant.find((v) => v.sku === product?.sku);
    price = Number(me?.offers?.price) || 0;
  }
  return {
    url: ORIGIN + pathKey(url),
    fetchedAt: new Date().toISOString(),
    jsonLd: product || null,
    price,
    tableSpecs,
    group: group
      ? {
          id: String(group.productGroupID || ""),
          name: text(group.name),
          axes: group.variesBy || [],
          selected,
          members: (group.hasVariant || []).map((v) => ({
            sku: v.sku,
            name: text(v.name),
            url: ORIGIN + pathKey(v.offers?.url || ""),
            price: Number(v.offers?.price) || 0,
            image: v.image || "",
            availability: v.offers?.availability || "",
          })),
        }
      : Object.keys(selected).length ? { id: "", selected, members: [] } : null,
    breadcrumb: (crumbs?.itemListElement || []).map((c) => text(c.name)).filter(Boolean),
  };
}

async function main() {
  const INPUT = (process.argv.find((a) => a.startsWith("--input=")) || "").slice(8) || path.join(WORK, "bb-confusions.json");
  const wanted = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const known = new Set();
  for (const line of fs.readFileSync(path.join(DIR, "bb-pdp.jsonl"), "utf8").split("\n")) {
    const m = line.match(/"url":"([^"]+)"/);
    if (m) known.add(pathKey(m[1]));
  }
  const done = new Set();
  if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean)) { try { done.add(pathKey(JSON.parse(l).url)); } catch {} }

  const queue = wanted.map(pathKey).filter((k) => !done.has(k)).slice(0, LIMIT);
  const queued = new Set([...queue, ...done]);
  const out = fs.createWriteStream(OUT, { flags: "a" });
  let n = 0, ok = 0, failed = 0, siblings = 0;

  async function worker() {
    while (queue.length) {
      const k = queue.shift();
      const res = await get(ORIGIN + k);
      n++;
      if (!res?.html) {
        failed++;
        out.write(JSON.stringify({ url: ORIGIN + k, error: res?.error || `HTTP ${res?.status}` }) + "\n");
      } else {
        const row = extract(res.html, k);
        out.write(JSON.stringify(row) + "\n");
        ok++;
        // complete the group: siblings never captured, or captured but not yet re-read
        for (const m of row.group?.members || []) {
          const mk = pathKey(m.url);
          if (mk.length > 3 && !queued.has(mk)) { queued.add(mk); queue.push(mk); if (!known.has(mk)) siblings++; }
        }
      }
      if (n % 25 === 0) console.log(`${n} fetched (${ok} ok, ${failed} failed, ${queue.length} queued, ${siblings} new siblings)`);
      await sleep(400);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out.end();
  console.log(`done: ${n} fetched, ${ok} ok, ${failed} failed, ${siblings} pages not in the original capture`);
}

main().catch((e) => { console.error(e); process.exit(1); });
