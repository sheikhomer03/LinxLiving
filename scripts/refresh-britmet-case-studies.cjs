/**
 * Re-scrape Britmet Case Studies onto family hero products (+ family SKUs).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-britmet-case-studies.cjs
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
const LOG = path.join(__dirname, "_tmp-britmet-case-studies.log");

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

function linksIn(chunk) {
  return [...chunk.matchAll(/href=["']([^"']+)["']/gi)].map((m) =>
    absUrl(m[1]),
  );
}

function imgsIn(chunk) {
  return [...chunk.matchAll(/src=["']([^"']+)["']/gi)]
    .map((m) => absUrl(m[1]))
    .filter((u) => /\.(jpg|jpeg|png|webp)/i.test(u))
    .map((u) => u.replace(/_t\.(jpg|jpeg|png|webp)$/i, ".$1"))
    .filter(
      (u) =>
        !/email|search|social|youtube|facebook|twitter|linkedin|pinterest|instagram|logo|x\.png|favicon|swatch/i.test(
          u,
        ),
    );
}

function parseCaseStudies(chunk) {
  const out = [];
  for (const m of chunk.matchAll(
    /<div[^>]*class=['"][^'"]*boxcasestudy[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const block = m[1];
    const pdfs = linksIn(block).filter((u) => /\.pdf/i.test(u));
    const imgs = imgsIn(block).filter((u) => /case-stud/i.test(u));
    const coverImage = imgs[0] || imgsIn(block)[0] || "";
    let name = "";
    for (const am of block.matchAll(
      /<a[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const text = cleanText(am[2]);
      if (text && text.length > 3) {
        name = text.slice(0, 200);
        break;
      }
    }
    if (!name && pdfs[0]) {
      name = path
        .basename(decodeURIComponent(pdfs[0]))
        .replace(/\.pdf$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
    }
    if (!name && !coverImage && !pdfs[0]) continue;
    out.push({
      name: name || "Case Study",
      coverImage,
      file: pdfs[0] || "",
    });
  }

  if (!out.length) {
    for (const m of chunk.matchAll(
      /<a[^>]+href=['"]([^'"]*case-stud[^'"]*\.pdf)['"][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const file = absUrl(m[1]);
      const name =
        cleanText(m[2]).slice(0, 200) ||
        path
          .basename(decodeURIComponent(file))
          .replace(/\.pdf$/i, "")
          .replace(/[-_]+/g, " ")
          .trim();
      const nearby = chunk.slice(
        Math.max(0, m.index - 400),
        Math.min(chunk.length, m.index + m[0].length + 200),
      );
      const coverImage =
        imgsIn(nearby).find((u) => /case-stud/i.test(u)) || "";
      if (!name) continue;
      out.push({ name, coverImage, file });
    }
  }

  const seen = new Set();
  return out.filter((c) => {
    const k = `${c.name}|${c.file}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function scrapeFamilyCaseStudies(fam) {
  const html = await fetchHtml(fam.page);
  const chunk =
    sectionAfterH2(html, `${fam.name} Case Studies`) ||
    sectionAfterH2(html, "Case Studies") ||
    html;
  return parseCaseStudies(chunk);
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
    let caseStudies = [];
    try {
      caseStudies = await scrapeFamilyCaseStudies(fam);
      log(`Scraped ${caseStudies.length} case studies`);
      if (caseStudies[0]) {
        log(
          `  sample: ${caseStudies[0].name} | pdf=${Boolean(caseStudies[0].file)} | img=${Boolean(caseStudies[0].coverImage)}`,
        );
      }
    } catch (e) {
      log(`FAIL scrape ${fam.name}: ${e.message}`);
      continue;
    }

    const hero = await db.collection("products").findOne({
      brand: brand._id,
      name: new RegExp(
        `^${fam.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    });
    if (!hero) {
      log(`No hero product for ${fam.name}`);
      continue;
    }

    if (DRY_RUN) {
      log(`[dry] would update ${hero.name}`);
      continue;
    }

    const setDoc = {
      caseStudies,
      updatedAt: new Date(),
      "specs.britmetCaseStudiesAt": new Date().toISOString(),
    };

    await db.collection("products").updateOne({ _id: hero._id }, { $set: setDoc });
    log(`Updated hero ${hero.name} caseStudies=${caseStudies.length}`);

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
    await new Promise((r) => setTimeout(r, 120));
  }

  log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
