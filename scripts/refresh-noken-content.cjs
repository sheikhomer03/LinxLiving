/**
 * Refresh Noken product names/descriptions/technical specs from live PDPs.
 * Keeps existing Cloudinary images. Decodes HTML entities.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-noken-content.cjs
 *
 * Options: LIMIT=50 CONCURRENCY=3 DRY_RUN=1 RESUME=1 ONLY_BAD=1
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
const PROGRESS = path.join(__dirname, "_tmp-noken-refresh-progress.json");
const LOG = path.join(__dirname, "_tmp-noken-refresh.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const ONLY_BAD = process.env.ONLY_BAD !== "0";
const RESUME = process.env.RESUME === "1";

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&ldquo;|&rdquo;|&#822[01];/g, '"')
    .replace(/&rsquo;|&#8217;/g, "'")
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
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractOg(html, prop) {
  const re1 = new RegExp(
    `property=["']${prop}["']\\s+content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `content=["']([^"']+)["']\\s+property=["']${prop}["']`,
    "i",
  );
  return cleanText((html.match(re1) || html.match(re2) || [])[1] || "");
}

function extractTitleTag(html) {
  return cleanText((html.match(/<title>([^<]+)/i) || [])[1] || "");
}

function extractSpecsFromHtml(html) {
  const specs = {};
  // common dt/dd or label/value patterns
  for (const m of html.matchAll(
    /<(?:dt|th|span|div|li)[^>]*>([^<:]{2,60})<\/(?:dt|th|span|div|li)>\s*<(?:dd|td|span|div)[^>]*>([^<]{1,200})<\/(?:dd|td|span|div)>/gi,
  )) {
    const k = cleanText(m[1]);
    const v = cleanText(m[2]);
    if (!k || !v) continue;
    if (/cookie|menu|cart|wishlist|share|follow/i.test(k + v)) continue;
    if (k.length > 50 || v.length > 180) continue;
    if (!specs[k]) specs[k] = v;
  }

  // "Key: Value" in list items
  for (const m of html.matchAll(/<li[^>]*>\s*([^<:]{2,40})\s*:\s*([^<]{1,120})<\/li>/gi)) {
    const k = cleanText(m[1]);
    const v = cleanText(m[2]);
    if (k && v && !specs[k]) specs[k] = v;
  }

  return specs;
}

function looksBad(p) {
  const d = p.description || "";
  if (/&#\d+;|&[a-z]+;/i.test(d)) return true;
  if (d.trim().length < 40) return true;
  if (/Noken bathroom product\.?$/i.test(d)) return true;
  // series-only name with short accessory description is often OK,
  // but name without product type is weak when description is the real title
  if (/^[A-Z0-9][A-Z0-9 \-/]+ — /.test(p.name) && d.length < 80) return true;
  return false;
}

function buildName(existing, ogTitle, pageTitle, finish) {
  // Prefer descriptive og/title over series-only "BASIC — CHROME"
  const series = (existing.name || "").split("—")[0].trim();
  const finishPart = finish || (existing.name || "").split("—")[1]?.trim() || "";
  const descriptive =
    ogTitle ||
    cleanText(pageTitle.replace(/\|\s*Noken.*$/i, "").replace(/^\d+\s+/, ""));

  if (descriptive && descriptive.length > 8 && !/^basic$/i.test(descriptive)) {
    if (finishPart && !new RegExp(finishPart, "i").test(descriptive)) {
      return `${descriptive} — ${finishPart}`;
    }
    return descriptive;
  }
  if (series && finishPart) return `${series} — ${finishPart}`;
  return existing.name;
}

function buildDescription(name, og, finish, techSpecs) {
  let desc = og || "";
  if (desc && finish && !new RegExp(finish, "i").test(desc)) {
    desc = `${desc}. Finish: ${finish}.`;
  }
  if (!desc || desc.length < 40) {
    const bits = Object.entries(techSpecs)
      .slice(0, 10)
      .map(([k, v]) => `${k}: ${v}`);
    desc =
      bits.length > 0
        ? `${name}. ${bits.join(". ")}.`
        : `${name}. Noken bathroom product.`;
  }
  return cleanText(desc).slice(0, 8000);
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

async function main() {
  fs.writeFileSync(LOG, `Noken refresh ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "noken" });
  if (!brand) throw new Error("noken brand missing");

  let products = await db
    .collection("products")
    .find({ brand: brand._id, "specs.source": "noken-scrape" })
    .toArray();

  if (ONLY_BAD) products = products.filter(looksBad);
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
  log(`Refreshing ${pending.length} of ${products.length} (onlyBad=${ONLY_BAD})`);

  let updated = 0;
  let failed = 0;
  const save = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const url = p.specs?.sourceUrl;
    if (!url) {
      // still decode entities locally
      const desc = cleanText(p.description || "");
      if (!DRY_RUN && desc !== p.description) {
        await db.collection("products").updateOne(
          { _id: p._id },
          { $set: { description: desc, updatedAt: new Date() } },
        );
        updated += 1;
      }
      done.add(String(p._id));
      return;
    }
    try {
      const html = await http(url);
      const og = extractOg(html, "og:description");
      const ogTitle = extractOg(html, "og:title");
      const pageTitle = extractTitleTag(html);
      const tech = extractSpecsFromHtml(html);
      const finish = p.specs?.finish || "";
      const name = buildName(p, ogTitle || og, pageTitle, finish);
      const description = buildDescription(name, og, finish, tech);

      const specs = {
        ...(p.specs || {}),
        ...tech,
        sku: p.specs?.sku,
        productCode: p.specs?.productCode || p.specs?.sku,
        source: "noken-scrape",
        sourceUrl: url,
        finish,
        agrupacion: p.specs?.agrupacion || "",
        nokenSap: p.specs?.nokenSap || p.specs?.sku,
        refreshedAt: new Date().toISOString(),
      };

      if (DRY_RUN) {
        log(`${label} [dry] ${name.slice(0, 70)} desc=${description.length} specs=${Object.keys(tech).length}`);
      } else {
        await db.collection("products").updateOne(
          { _id: p._id },
          {
            $set: {
              name,
              description,
              specs,
              updatedAt: new Date(),
            },
          },
        );
        log(`${label} ok ${name.slice(0, 70)} specs+=${Object.keys(tech).length}`);
      }
      updated += 1;
      done.add(String(p._id));
      if (updated % 25 === 0) save();
      await delay(80);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${url} ${e.message}`);
      await delay(300);
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
