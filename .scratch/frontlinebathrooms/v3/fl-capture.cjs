/**
 * Frontline Bathrooms — full read-only capture (GET/POST to the public site only;
 * no DB, no Shopify). Writes ONLY into .scratch/frontlinebathrooms/v3/.
 *
 *  1. every product from the public WP API (title, description, taxonomies)
 *     + the taxonomy term names (brand, range, collection, width, product-type,
 *     product-category, group-id)
 *  2. every product page: gallery photos, key-feature bullets, "Additional
 *     Information", the option dropdown, and Ref (F code) + Price when shown
 *  3. every dropdown option (the site loads it with a form POST
 *     product-select=<id>): its own Ref, Price, label and photos
 *
 * Resumable: products already in live.jsonl are skipped.
 *   node .scratch/frontlinebathrooms/v3/fl-capture.cjs [--limit=N]
 */
const fs = require("fs");
const path = require("path");
const ORIGIN = "https://www.frontlinebathrooms.co.uk";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const OUT = path.join(__dirname, "live.jsonl");
const TERMS = path.join(__dirname, "terms.json");
const LOG = path.join(__dirname, "progress.log");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").slice(8)) || Infinity;
const CONCURRENCY = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "–", mdash: "—", hellip: "…", deg: "°", pound: "£", times: "×", reg: "®", trade: "™" };
const decode = (s) => String(s ?? "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const text = (h) => decode(String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

async function req(url, opts = {}, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { "user-agent": UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return { status: 404 };
      if (!r.ok) throw new Error("HTTP " + r.status);
      return { status: r.status, body: await r.text(), headers: r.headers };
    } catch (e) { if (i === tries) return { error: e.message }; await sleep(1500 * i); }
  }
}

/** what a product (or option) page shows */
function parsePage(h) {
  const main = h.split(/Related Products|You May Also Like/i)[0];
  const flat = text(main.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " "));
  const ref = (flat.match(/Ref:\s*(F[\w-]+)/) || [])[1] || "";
  const pm = flat.match(/Price:\s*£\s?([\d,]+(?:\.\d+)?)\s*(?:\(([^)]*)\))?/);
  const price = pm ? Number(pm[1].replace(/,/g, "")) : 0;
  const priceNote = pm?.[2] || "";
  const sel = (main.match(/<select name="product-select"[\s\S]*?<\/select>/) || [""])[0];
  const options = [...sel.matchAll(/<option value="(\d+)"\s*(selected[^>]*)?[^>]*>([^<]*)</g)].map((m) => ({ id: m[1], selected: !!m[2], label: text(m[3]) }));
  // gallery only: the product-gallery blocks, never the logos or related products
  const galleries = [...main.matchAll(/<div class="[^"]*product-gallery[\s\S]*?(?=<div class="[^"]*product-gallery|<div class="row d-flex flex-column flex-xl-row product"|$)/g)].map((m) => m[0]).join(" ");
  const images = [...new Set([...galleries.matchAll(/<img[^>]+?(?:data-src|src)="(https?:\/\/[^"]+\/wp-content\/uploads\/[^"]+)"[^>]*>/g)].map((m) => m[1]).filter((u) => !/logo|word-mark|briten/i.test(u)))];
  // key features: the paragraph(s) between the selector / title block and "Find a Retailer"
  const fr = main.search(/<a href="\/find-a-retailer\/" class="button/);
  let featuresHtml = "";
  if (fr > 0) {
    const before = main.slice(Math.max(0, fr - 6000), fr);
    const cut = Math.max(before.lastIndexOf("</form>"), before.lastIndexOf("Price:"), before.lastIndexOf("Ref:"));
    featuresHtml = before.slice(cut > 0 ? cut : 0);
  }
  const features = text(featuresHtml).split("\n").map((l) => l.replace(/^[•\-\s|]+/, "").replace(/^[^A-Za-z0-9£]*(Price|Ref):.*$/i, "").trim()).filter((l) => l && l.length > 1 && !/^(Price|Ref)\b/i.test(l) && !/^(Request a|Brochure|Find a Retailer|Select a variation)/i.test(l));
  // "Additional Information": rows of <strong>label</strong> … value
  const info = {};
  for (const m of main.matchAll(/<div class="row product-table-row[^"]*">([\s\S]*?)(?=<div class="row product-table-row|<\/section>|<h2|$)/g)) {
    const label = text((m[1].match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || "");
    const valueHtml = m[1].split(/<\/strong>/)[1] || "";
    const value = text(valueHtml).replace(/\s*\n\s*/g, ", ").replace(/^,\s*|,\s*$/g, "");
    if (label && value && label.length < 50) info[label] = value;
  }
  const selectedLabel = (options.find((o) => o.selected) || {}).label || "";
  return { ref, price, priceNote, options, images, features, info, selectedLabel };
}

async function main() {
  fs.mkdirSync(__dirname, { recursive: true });
  // ---- 1. taxonomies + product list
  const taxes = ["brand", "range", "collection", "width", "product-type", "product-category", "group-id"];
  let terms = fs.existsSync(TERMS) ? JSON.parse(fs.readFileSync(TERMS, "utf8")) : null;
  if (!terms) {
    terms = {};
    for (const t of taxes) {
      terms[t] = {};
      for (let page = 1; ; page++) {
        const r = await req(`${ORIGIN}/wp-json/wp/v2/${t}?per_page=100&page=${page}&_fields=id,name,slug,parent`);
        if (!r.body) break;
        const arr = JSON.parse(r.body);
        if (!Array.isArray(arr) || !arr.length) break;
        for (const x of arr) terms[t][x.id] = { name: decode(x.name), slug: x.slug, parent: x.parent || 0 };
        if (arr.length < 100) break;
      }
      log(`terms ${t}: ${Object.keys(terms[t]).length}`);
    }
    fs.writeFileSync(TERMS, JSON.stringify(terms));
  }
  const products = [];
  for (let page = 1; ; page++) {
    const r = await req(`${ORIGIN}/wp-json/wp/v2/product?per_page=100&page=${page}&_fields=id,slug,link,title,content,modified,${taxes.join(",")}`);
    if (!r.body) break;
    const arr = JSON.parse(r.body);
    if (!Array.isArray(arr) || !arr.length) break;
    products.push(...arr);
    if (arr.length < 100) break;
  }
  log(`API products: ${products.length}`);

  const done = new Set();
  if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean)) { try { done.add(JSON.parse(l).id); } catch {} }
  const SLUG = (process.argv.find((a) => a.startsWith("--slug=")) || "").slice(7);
  const queue = products.filter((p) => !done.has(p.id) && (!SLUG || p.slug === SLUG)).slice(0, LIMIT);
  log(`start: ${queue.length} product pages to read (${done.size} already done)`);
  const out = fs.createWriteStream(OUT, { flags: "a" });
  let n = 0, priced = 0, optionPages = 0, failed = 0;
  const t0 = Date.now();

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      const row = {
        id: p.id, slug: p.slug, url: p.link, title: decode(p.title?.rendered), description: p.content?.rendered || "", modified: p.modified,
        tax: Object.fromEntries(taxes.map((t) => [t, (p[t] || []).map((id) => terms[t][id]?.name).filter(Boolean)])),
        taxSlugs: Object.fromEntries(taxes.map((t) => [t, (p[t] || []).map((id) => terms[t][id]?.slug).filter(Boolean)])),
      };
      const r = await req(p.link);
      if (!r.body) { failed++; row.error = r.error || `HTTP ${r.status}`; out.write(JSON.stringify(row) + "\n"); n++; continue; }
      const page = parsePage(r.body);
      Object.assign(row, { ref: page.ref, price: page.price, priceNote: page.priceNote, images: page.images, features: page.features, info: page.info, dropdown: page.options });
      // each dropdown option other than this page itself
      row.optionPages = [];
      for (const o of page.options.filter((o) => String(o.id) !== String(p.id))) {
        const q = await req(p.link, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `product-select=${o.id}` });
        optionPages++;
        if (!q.body) { row.optionPages.push({ id: o.id, label: o.label, error: q.error || `HTTP ${q.status}` }); continue; }
        const op = parsePage(q.body);
        row.optionPages.push({ id: o.id, label: o.label, selectedLabel: op.selectedLabel, ref: op.ref, price: op.price, priceNote: op.priceNote, images: op.images, features: op.features, info: op.info });
        await sleep(150);
      }
      if (row.price > 0 || row.optionPages.some((o) => o.price > 0)) priced++;
      out.write(JSON.stringify(row) + "\n");
      n++;
      if (n % 50 === 0) {
        const rate = n / ((Date.now() - t0) / 1000);
        log(`${n}/${n + queue.length} products · ${optionPages} option pages · ${priced} with a price · ${failed} failed · ~${Math.round(queue.length / rate / 60)} min left`);
      }
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out.end();
  log(`DONE: ${n} products, ${optionPages} option pages, ${priced} with a price, ${failed} failed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
