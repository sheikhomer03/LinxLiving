/**
 * Scrape Noken "Downloads" section (name + file URL + icon) into product.downloads.
 *
 * Source: https://www.noken.com/en/products/
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-noken-downloads.cjs
 *
 * Options: LIMIT=20 CONCURRENCY=2 DRY_RUN=1 RESUME=1
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://www.noken.com";
const BRAND_SLUG = "noken";
const PROGRESS = path.join(__dirname, "_tmp-noken-downloads-progress.json");
const LOG = path.join(__dirname, "_tmp-noken-downloads.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const RESUME = process.env.RESUME !== "0";
const ONLY_IDS = String(process.env.ONLY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function http(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: `${BASE}/en/products`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    },
  );
  await Promise.all(runners);
}

function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${BASE}${s}`;
  return s;
}

function inferType(title, url) {
  const t = `${title} ${url}`.toLowerCase();
  if (/install/i.test(t)) return "install";
  if (/cert|warrant|garant|security|seguridad/i.test(t)) return "certificate";
  if (/\b2d\b|\b3d\b|\.dwg|\.fbx|\.obj|\.max|cad\/|technical drawing/i.test(t))
    return "drawing";
  if (/\.pdf($|\?)/i.test(url) || /pdf|sheet|spare|repuesto|manten/i.test(t))
    return "pdf";
  return "other";
}

function extractIcon(chunk) {
  const m =
    chunk.match(/src=["']([^"']*product-icons[^"']+)["']/i) ||
    chunk.match(/src=["']([^"']*icon-[^"']+\.(?:png|jpg|webp))["']/i) ||
    chunk.match(/srcset=["']([^"'\s]+\.(?:png|jpg|webp))/i);
  return absUrl(m?.[1] || "");
}

/**
 * Parse #dropDescargas / #downloads block into product.downloads entries.
 */
function parseDownloads(html) {
  const section =
    html.match(
      /id=["']dropDescargas["'][\s\S]*?(?=id=["']dropRepuestos["']|Technical information|<div class=["']container["']>\s*<a class=["']drop-toggle)/i,
    ) ||
    html.match(
      /Downloads[\s\S]{0,200}id=["']dropDescargas["']([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div class=["']container["']>/i,
    );
  const chunk = section ? section[0] : "";
  if (!chunk) return [];

  const out = [];
  const seen = new Set();

  // Grouped downloads (2D / 3D)
  for (const m of chunk.matchAll(
    /<div class=["']dropdown download-icon["']>([\s\S]*?)<ul class=["']dropdown-menu["']>([\s\S]*?)<\/ul>/gi,
  )) {
    const head = m[1];
    const menu = m[2];
    const title = cleanText(
      (head.match(/<span class=["']upc["'][^>]*>([\s\S]*?)<\/span>/i) ||
        [])[1] || "",
    );
    if (!title) continue;
    const children = [];
    for (const c of menu.matchAll(
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const url = absUrl(c[1]);
      const childTitle = cleanText(c[2]);
      if (!url || !childTitle || /^javascript:/i.test(url)) continue;
      children.push({ title: childTitle, url });
    }
    if (!children.length) continue;
    const key = `g:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url: children[0].url,
      type: inferType(title, children[0].url),
      iconUrl: extractIcon(head),
      children,
    });
  }

  // Simple download icons
  for (const m of chunk.matchAll(
    /<a href=["']([^"']+)["'][^>]*class=["'][^"']*download-icon[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = absUrl(m[1]);
    const inner = m[2];
    const title = cleanText(
      (inner.match(/<span class=["']upc["'][^>]*>([\s\S]*?)<\/span>/i) ||
        [])[1] || "",
    );
    if (!title || !url || /^javascript:/i.test(url) || !url) continue;
    const key = `${title}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      type: inferType(title, url),
      iconUrl: extractIcon(inner),
      children: [],
    });
  }

  return out;
}

async function main() {
  fs.writeFileSync(LOG, `Noken downloads ${new Date().toISOString()}\n`);
  const c = await connectMongo();
  const db = c.db;

  const brand = await db.collection("brands").findOne({
    $or: [{ slug: BRAND_SLUG }, { slug: /^noken$/i }],
  });
  if (!brand) throw new Error("Noken brand not found");

  const filter = ONLY_IDS.length
    ? {
        _id: {
          $in: ONLY_IDS.map((id) => new mongoose.Types.ObjectId(id)),
        },
      }
    : {
        $or: [{ brand: brand._id }, { "specs.source": "noken-scrape" }],
      };
  let products = await db
    .collection("products")
    .find(filter)
    .project({ name: 1, specs: 1, downloads: 1 })
    .toArray();

  products = products.filter(
    (p) =>
      String(p.specs?.source || "") === "noken-scrape" ||
      String(p.specs?.sourceUrl || "").includes("noken.com"),
  );

  if (LIMIT > 0) products = products.slice(0, LIMIT);

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }

  const pending = products.filter((p) => !done.has(String(p._id)));
  log(
    `Noken downloads total=${products.length} pending=${pending.length} concurrency=${CONCURRENCY}${DRY_RUN ? " DRY" : ""}`,
  );

  let updated = 0;
  let failed = 0;
  const save = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const url = String(p.specs?.sourceUrl || "").trim();
    const sap = String(
      p.specs?.nokenSap || p.specs?.sku || p.specs?.productCode || "",
    ).trim();
    if (!url) {
      done.add(String(p._id));
      return;
    }
    try {
      const html = await http(url);
      const downloads = parseDownloads(html);
      if (DRY_RUN) {
        log(`${label} [dry] ${sap || "?"} downloads=${downloads.length}`);
      } else if (downloads.length) {
        await db.collection("products").updateOne(
          { _id: p._id },
          {
            $set: {
              downloads,
              updatedAt: new Date(),
              "specs.nokenDownloadsRefreshedAt": new Date().toISOString(),
            },
          },
        );
        log(`${label} ok ${sap || "?"} downloads=${downloads.length}`);
      } else {
        log(`${label} none ${sap || "?"}`);
      }
      updated += 1;
      done.add(String(p._id));
      if (updated % 25 === 0) save();
      await delay(100);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${url} ${e.message}`);
      await delay(350);
    }
  });

  save();
  log(`Done updated=${updated} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
