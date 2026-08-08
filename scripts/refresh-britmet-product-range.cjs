/**
 * Re-scrape Britmet Product Range cards + accessory detail modals
 * onto family hero products (fixes broken "DIV>" names).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-britmet-product-range.cjs
 *   DRY_RUN=1
 *   ONLY=liteslate
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

const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://www.britmet.co.uk";
const BRAND_SLUG = "britmet";
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY = String(process.env.ONLY || "")
  .trim()
  .toLowerCase();
const LOG = path.join(__dirname, "_tmp-britmet-product-range.log");

const LR_FAMILIES = [
  { name: "Liteslate", slug: "liteslate", page: `${BASE}/liteslate.asp` },
  { name: "Shingle", slug: "shingle", page: `${BASE}/shingle.asp` },
  { name: "Slate 2000", slug: "slate-2000", page: `${BASE}/slate2000.asp` },
  { name: "Ultratile", slug: "ultratile", page: `${BASE}/ultratile.asp` },
  { name: "Villatile", slug: "villatile", page: `${BASE}/villatile.asp` },
  { name: "Profile 49", slug: "profile-49", page: `${BASE}/profile49.asp` },
  { name: "Plaintile", slug: "plaintile", page: `${BASE}/plaintile.asp` },
  {
    name: "Pantile 2000",
    slug: "pantile-2000",
    page: `${BASE}/pantile2000.asp`,
  },
  { name: "Ecopan", slug: "ecopan", page: `${BASE}/ecopan.asp` },
  { name: "Parcpan", slug: "parcpan", page: `${BASE}/parcpan.asp` },
];

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function absUrl(href) {
  let u = String(href || "")
    .trim()
    .split("#")[0];
  if (!u) return "";
  u = u.replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = "https:" + u;
  else if (u.startsWith("/")) u = BASE + u;
  else if (!/^https?:\/\//i.test(u)) u = `${BASE}/${u.replace(/^\.\//, "")}`;
  return u;
}

function cleanText(html) {
  return String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanRangeName(name) {
  let n = cleanText(name)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || /^div>?$/i.test(n) || /^(<|>|\/)/.test(n)) return "";
  n = n.replace(/^liteslate\s*[-–]\s*/i, "Liteslate - ");
  n = n.replace(/^shingle\s*[-–]\s*/i, "Shingle - ");
  n = n.replace(/^ultratile\s*[-–]\s*/i, "Ultratile - ");
  n = n.replace(/^villatile\s*[-–]\s*/i, "Villatile - ");
  n = n.replace(/^plaintile\s*[-–]\s*/i, "Plaintile - ");
  n = n.replace(/^parcpan\s*[-–]\s*/i, "Parcpan - ");
  n = n.replace(/^ecopan\s*[-–]\s*/i, "Ecopan - ");
  n = n.replace(/^ecopan\s+/i, "Ecopan ");
  n = n.replace(/^pantile\s*2000\s*[-–]\s*/i, "Pantile 2000 - ");
  n = n.replace(/^slate\s*2000\s*[-–]\s*/i, "Slate 2000 - ");
  n = n.replace(/^profile\s*49\s*[-–]\s*/i, "Profile 49 - ");
  return n;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function sectionAfterH2(html, label) {
  const re = new RegExp(
    `<h2[^>]*>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s\\S]*?<\\/h2>([\\s\\S]*?)(?=<h2\\b|$)`,
    "i",
  );
  const m = html.match(re);
  return m ? m[1] : "";
}

function parseProductRange(chunk) {
  const items = [];
  for (const m of chunk.matchAll(
    /<a[^>]*data-src=['"]([^'"]*aid=\d+[^'"]*)['"][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const detailUrl = absUrl(m[1]);
    const inner = m[2];
    const aid = ((detailUrl.match(/aid=(\d+)/i) || [])[1] || "").trim();
    const name = cleanRangeName(
      (inner.match(
        /class=['"][^'"]*productrangeheading[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i,
      ) ||
        inner.match(
          /class=['"][^'"]*productchooseheading[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i,
        ) ||
        [])[1] || "",
    );
    const image = absUrl(
      (inner.match(/<img[^>]+src=['"]([^'"]+)['"]/i) || [])[1] || "",
    );
    if (!name || !image) continue;
    if (/swatch|logo|email|search/i.test(image)) continue;
    items.push({
      name,
      image,
      aid,
      detailUrl,
      tableHeadings: ["", ""],
      tableRows: [],
    });
  }
  const seen = new Set();
  return items.filter((it) => {
    const k = `${it.aid || ""}|${it.name}|${it.image}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function enrichProductRangeDetails(items) {
  const out = [];
  for (const item of items) {
    const next = {
      name: item.name,
      image: item.image,
      tableHeadings: ["", ""],
      tableRows: [],
    };
    if (!item.detailUrl && !item.aid) {
      out.push(next);
      continue;
    }
    const url =
      item.detailUrl || `${BASE}/accessories-colours.asp?aid=${item.aid}`;
    try {
      const html = await fetchHtml(url);
      const title = cleanRangeName(
        (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || item.name,
      );
      if (title) next.name = title;
      const img = absUrl(
        (html.match(
          /class=['"][^'"]*accessorypic[^'"]*['"][^>]*>[\s\S]*?<img[^>]+src=['"]([^'"]+)['"]/i,
        ) ||
          html.match(/<img[^>]+src=['"]([^'"]*accessories[^'"]*)['"]/i) ||
          [])[1] || "",
      );
      if (img) next.image = img;
      const rows = [];
      for (const tr of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
        const cells = [
          ...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi),
        ].map((c) => cleanText(c[1]));
        if (cells.length >= 2 && cells[0]) {
          rows.push([cells[0], cells[1] || ""]);
        }
      }
      if (rows.length) {
        next.tableHeadings = ["", ""];
        next.tableRows = rows;
      }
      await new Promise((r) => setTimeout(r, 60));
    } catch (e) {
      log(`  range detail fail ${item.name}: ${e.message}`);
    }
    out.push(next);
  }
  return out;
}

async function scrapeFamilyRange(fam) {
  const html = await fetchHtml(fam.page);
  const rangeChunk =
    sectionAfterH2(html, "Product Range") ||
    sectionAfterH2(html, "Product range") ||
    html;
  const parsed = parseProductRange(rangeChunk);
  return enrichProductRangeDetails(parsed);
}

async function main() {
  fs.writeFileSync(LOG, "");
  const families = ONLY
    ? LR_FAMILIES.filter((f) => f.slug === ONLY || f.name.toLowerCase() === ONLY)
    : LR_FAMILIES;
  if (!families.length) throw new Error(`No family matched ONLY=${ONLY}`);

  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({
    $or: [{ slug: BRAND_SLUG }, { name: /britmet/i }],
  });
  if (!brand) throw new Error("Britmet brand not found");
  log(`Brand=${brand.name} dryRun=${DRY_RUN} families=${families.length}`);

  for (const fam of families) {
    log(`--- ${fam.name} ---`);
    let productRange = [];
    try {
      productRange = await scrapeFamilyRange(fam);
      log(
        `Scraped ${productRange.length} range items (withSpecs=${productRange.filter((x) => x.tableRows?.length).length})`,
      );
      if (productRange[0]) {
        log(
          `  sample: ${productRange[0].name} rows=${productRange[0].tableRows?.length || 0}`,
        );
      }
    } catch (e) {
      log(`FAIL scrape ${fam.name}: ${e.message}`);
      continue;
    }

    // Prefer exact family hero name (same as revamp upsert), then site-sourced family flag.
    let hero = await db.collection("products").findOne({
      brand: brand._id,
      name: new RegExp(
        `^${fam.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    });
    if (!hero) {
      hero = await db.collection("products").findOne({
        brand: brand._id,
        "specs.britmetFamily": fam.slug,
        "specs.source": "britmet-site",
        name: new RegExp(fam.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      });
    }
    if (!hero) {
      log(`No hero product for ${fam.name}`);
      continue;
    }

    if (DRY_RUN) {
      log(`[dry] would update hero ${hero._id} ${hero.name} + family SKUs`);
      continue;
    }

    const setDoc = {
      productRange,
      updatedAt: new Date(),
      "specs.britmetProductRangeAt": new Date().toISOString(),
    };

    await db.collection("products").updateOne({ _id: hero._id }, { $set: setDoc });
    log(`Updated hero ${hero.name} (${hero._id}) productRange=${productRange.length}`);

    // Also refresh remapped family SKUs that still carry the old broken "DIV>" ranges
    const skuRes = await db.collection("products").updateMany(
      {
        brand: brand._id,
        _id: { $ne: hero._id },
        $or: [
          { "specs.britmetFamily": fam.slug },
          { subCategory: fam.slug, category: "lightweight-roofing" },
        ],
      },
      { $set: setDoc },
    );
    log(`  synced SKUs matched=${skuRes.matchedCount} modified=${skuRes.modifiedCount}`);
  }

  log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
