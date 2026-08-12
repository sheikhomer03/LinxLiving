/**
 * Revamp Britmet to match https://www.britmet.co.uk/
 * - 5 main categories + Lightweight Roofing sub-families
 * - Remap existing PDF SKUs into that taxonomy
 * - Scrape family page galleries + documentation tabs onto products
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/revamp-britmet-from-site.cjs
 *   DRY_RUN=1
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

const BASE = "https://www.britmet.co.uk";
const BRAND_SLUG = "britmet";
const DRY_RUN = process.env.DRY_RUN === "1";
const LOG = path.join(__dirname, "_tmp-britmet-revamp.log");

const MAIN_CATEGORIES = [
  {
    name: "Lightweight Roofing",
    slug: "lightweight-roofing",
    image: `${BASE}/images/products/lightweight.jpg`,
    page: `${BASE}/lightweight-roofing.asp`,
  },
  {
    name: "Door Canopies",
    slug: "door-canopies",
    image: `${BASE}/images/products/door-canopies.jpg`,
    page: `${BASE}/door-canopies.asp`,
  },
  {
    name: "Structural Trays",
    slug: "structural-trays",
    image: `${BASE}/images/products/tactray90.jpg`,
    page: `${BASE}/tactray90.asp`,
  },
  {
    name: "Flat-to-Pitch Solutions",
    slug: "flat-to-pitch-solutions",
    image: `${BASE}/images/products/britframe.jpg`,
    page: `${BASE}/flat-to-pitch-roof-solutions.asp`,
  },
  {
    name: "Paint",
    slug: "paint",
    image: `${BASE}/images/products/paints2.jpg`,
    page: `${BASE}/paint.asp`,
  },
];

/** Lightweight Roofing sub-families (site product submenu). */
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

const DOOR_CANOPIES = [
  {
    name: "The Kingfisher",
    slug: "the-kingfisher",
    image: `${BASE}/images/products/the-kingfisher.jpg`,
  },
  {
    name: "The Coneygree",
    slug: "the-coneygree",
    image: `${BASE}/images/products/the-coneygree.jpg`,
  },
  {
    name: "The Attley",
    slug: "the-attley",
    image: `${BASE}/images/products/the-attley.jpg`,
  },
  {
    name: "The Regent",
    slug: "the-regent",
    image: `${BASE}/images/products/the-regent.jpg`,
  },
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

function parseKvTable(chunk) {
  const specs = {};
  for (const tr of chunk.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (c) => cleanText(c[1]),
    );
    if (cells.length >= 2 && cells[0] && cells[1]) {
      const key = cells[0].replace(/:$/, "").trim();
      if (/^ref$/i.test(key) || /^description$/i.test(key)) continue;
      specs[key] = cells[1];
    }
  }
  return specs;
}

function parseDrawingTable(chunk) {
  const rows = [];
  for (const tr of chunk.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cellHtmls = [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (c) => c[1],
    );
    if (cellHtmls.length < 2) continue;
    const ref = cleanText(cellHtmls[0]);
    const description = cleanText(cellHtmls[1]);
    if (!ref || /^ref$/i.test(ref)) continue;
    const fileCell = cellHtmls[2] || cellHtmls.slice(2).join(" ");
    const files = [];
    for (const m of String(fileCell).matchAll(
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const url = absUrl(m[1]);
      const name = cleanText(m[2]) || (/\.dwg/i.test(url) ? "DWG" : "PDF");
      if (url) files.push({ name, url });
    }
    // fallback: any pdf links in row
    if (!files.length) {
      for (const u of linksIn(tr[0]).filter((x) => /\.(pdf|dwg)/i.test(x))) {
        files.push({
          name: /\.dwg/i.test(u) ? "DWG" : "PDF",
          url: u,
        });
      }
    }
    if (ref || description || files.length) {
      rows.push({ ref, description, files });
    }
  }
  return rows;
}

function parseCaseStudies(chunk) {
  const out = [];
  // Site cards:
  // <div class='...boxcasestudy...'>
  //   <a href='...pdf'><img src='images/case-studies/...'></a>
  //   <a href='...pdf'>Title text</a>
  // </div>
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

  // Fallback: any case-study PDF + nearby image/title
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

function cleanRangeName(name) {
  let n = cleanText(name)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || /^div>?$/i.test(n) || /^(<|>|\/)/.test(n)) return "";
  // Title-case common lowercase family prefixes from site HTML
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

function parseProductRange(chunk) {
  const items = [];
  // Site cards (Fancybox iframe):
  // <a data-src='accessories-colours.asp?aid=38'>
  //   <p class='...productrangeheading'>Ancillaries - Eave Vent Strip</p>
  //   <img src='images/accessories/...'></a>
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

function parseFamilyPage(html, familyName) {
  const overview =
    sectionAfterH2(html, `${familyName} Overview`) ||
    sectionAfterH2(html, "Overview");
  const brochure =
    sectionAfterH2(html, `${familyName} Brochure`) ||
    sectionAfterH2(html, "Brochure");
  const gallery =
    sectionAfterH2(html, `${familyName} Photo Gallery`) ||
    sectionAfterH2(html, "Photo Gallery");
  const range =
    sectionAfterH2(html, `${familyName} Product Range`) ||
    sectionAfterH2(html, "Product Range");
  const cases =
    sectionAfterH2(html, `${familyName} Case Studies`) ||
    sectionAfterH2(html, "Case Studies");
  const tech =
    sectionAfterH2(html, `${familyName} Technical Spec`) ||
    sectionAfterH2(html, "Technical Spec");
  const general =
    sectionAfterH2(html, `${familyName} General Specification`) ||
    sectionAfterH2(html, "General Specification");
  const install =
    sectionAfterH2(html, `${familyName} Installer Guide`) ||
    sectionAfterH2(html, "Installer Guide");
  const drawings =
    sectionAfterH2(html, `${familyName} Technical Drawings`) ||
    sectionAfterH2(html, "Technical Drawings");

  const description = cleanText(overview).slice(0, 4000);
  const brochures = linksIn(brochure)
    .filter((u) => /\.pdf/i.test(u))
    .map((url) => ({
      name: /datasheet|technical/i.test(url)
        ? "Technical Datasheet (PDF)"
        : /brochure/i.test(url)
          ? "Brochure (PDF)"
          : path.basename(decodeURIComponent(url)).slice(0, 80),
      url,
    }));
  // unique brochures
  const brochuresSeen = new Set();
  const brochuresUnique = brochures.filter((b) => {
    if (brochuresSeen.has(b.url)) return false;
    brochuresSeen.add(b.url);
    return true;
  });

  const galleryImgs = imgsIn(gallery).filter((u) => /gallery|products\//i.test(u));
  const hero =
    absUrl(
      (
        html.match(
          /src=["']([^"']*images\/products\/[^"']*productphoto[^"']*)["']/i,
        ) || []
      )[1] || "",
    ) || galleryImgs[0] || "";

  const images = [...new Set([hero, ...galleryImgs].filter(Boolean))].slice(
    0,
    24,
  );

  const techSpecs = parseKvTable(tech);
  const techImgs = imgsIn(tech);
  const schematicImage = techImgs[0] || "";

  // productRange enriched by caller (async)
  const productRange = parseProductRange(range);
  const caseStudies = parseCaseStudies(cases);
  const generalSpecification = {
    content: cleanText(general).slice(0, 8000),
    image: imgsIn(general)[0] || "",
  };
  const installerGuides = linksIn(install)
    .filter((u) => /\.pdf/i.test(u))
    .map((url) => ({
      name: /care|maintenance/i.test(url)
        ? "Care and Maintenance Guide (PDF)"
        : /train|install|manual/i.test(url)
          ? "Installer Guide (PDF)"
          : path.basename(decodeURIComponent(url)).slice(0, 80),
      url,
    }));
  const installerSeen = new Set();
  const installerUnique = installerGuides.filter((g) => {
    if (installerSeen.has(g.url)) return false;
    installerSeen.add(g.url);
    return true;
  });

  const drawingEntries = parseDrawingTable(drawings);

  return {
    description,
    images,
    specs: techSpecs,
    schematicImage,
    brochures: brochuresUnique,
    productRange,
    caseStudies,
    generalSpecification,
    installerGuides: installerUnique,
    drawingEntries,
  };
}

function mapSkuToFamily(name, oldCategory) {
  const n = `${name} ${oldCategory || ""}`;
  for (const fam of LR_FAMILIES) {
    const re = new RegExp(
      fam.name.replace(/\s+/g, "\\s*").replace(/([()])/g, "\\$1"),
      "i",
    );
    if (re.test(n)) {
      return {
        category: "lightweight-roofing",
        subCategory: fam.slug,
        family: fam,
      };
    }
  }
  if (/slate\s*2000/i.test(n))
    return {
      category: "lightweight-roofing",
      subCategory: "slate-2000",
      family: LR_FAMILIES.find((f) => f.slug === "slate-2000"),
    };
  if (/profile\s*49/i.test(n))
    return {
      category: "lightweight-roofing",
      subCategory: "profile-49",
      family: LR_FAMILIES.find((f) => f.slug === "profile-49"),
    };
  if (/pantile/i.test(n))
    return {
      category: "lightweight-roofing",
      subCategory: "pantile-2000",
      family: LR_FAMILIES.find((f) => f.slug === "pantile-2000"),
    };
  if (/ecopan\s*plus/i.test(n))
    return { category: "lightweight-roofing", subCategory: "ecopan", family: LR_FAMILIES.find((f) => f.slug === "ecopan") };
  if (/paint|stipple|primer|scrim|roller|masonry|roof\s*coat/i.test(n) || oldCategory === "paint")
    return { category: "paint", subCategory: "", family: null };
  if (/tactray|structural\s*tray/i.test(n))
    return { category: "structural-trays", subCategory: "", family: null };
  if (/britframe|flat.?to.?pitch/i.test(n))
    return { category: "flat-to-pitch-solutions", subCategory: "", family: null };
  if (/canopy|kingfisher|coneygree|attley|regent/i.test(n))
    return { category: "door-canopies", subCategory: "", family: null };
  // generic panels/flashings/fixings from PDF → pantile-2000 accessories bucket when pantile-ish else lightweight root
  if (/panel|flashing|fixing|membrane|carriage|machiner|roof\s*light|fakro|guillotine|bender/i.test(n) ||
      /panel|flashing|fixing|membrane|carriage|machiner|roof-light/i.test(oldCategory || "")) {
    return { category: "lightweight-roofing", subCategory: "", family: null };
  }
  return { category: "lightweight-roofing", subCategory: "", family: null };
}

async function upsertMenu(db, { name, slug, parent, brandId, departmentId, image, order, level }) {
  const existing = await db.collection("menus").findOne({
    brand: brandId,
    slug,
    ...(parent ? { parent } : { parent: null }),
  });
  const doc = {
    name,
    slug,
    parent: parent || null,
    brand: brandId,
    department: departmentId || null,
    image: image || "",
    order: order || 0,
    level: level || (parent ? "subcategory" : "category"),
    isActive: true,
    updatedAt: new Date(),
  };
  if (DRY_RUN) return existing?._id || new mongoose.Types.ObjectId();
  if (existing) {
    await db.collection("menus").updateOne({ _id: existing._id }, { $set: doc });
    return existing._id;
  }
  const res = await db.collection("menus").insertOne({
    ...doc,
    createdAt: new Date(),
    subBrand: "",
    subBrands: [],
  });
  return res.insertedId;
}

async function main() {
  fs.writeFileSync(LOG, `Britmet revamp ${new Date().toISOString()}\n`);
  const c = await connectMongo();
  const db = c.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Britmet brand not found");
  const dept =
    (await db.collection("departments").findOne({ slug: "roofing" })) || null;

  log(`Brand=${brand.name} dryRun=${DRY_RUN}`);

  // 1) Deactivate old Britmet menus
  if (!DRY_RUN) {
    await db.collection("menus").updateMany(
      { brand: brand._id },
      { $set: { isActive: false, updatedAt: new Date() } },
    );
  }
  log("Deactivated old Britmet menus");

  // 2) Create 5 main + LR submenus
  const catIds = {};
  for (let i = 0; i < MAIN_CATEGORIES.length; i++) {
    const cat = MAIN_CATEGORIES[i];
    catIds[cat.slug] = await upsertMenu(db, {
      name: cat.name,
      slug: cat.slug,
      parent: null,
      brandId: brand._id,
      departmentId: dept?._id || null,
      image: cat.image,
      order: i + 1,
      level: "category",
    });
    log(`Category ${cat.name}`);
  }

  const lrParent = catIds["lightweight-roofing"];
  const familyDocs = {};
  for (let i = 0; i < LR_FAMILIES.length; i++) {
    const fam = LR_FAMILIES[i];
    await upsertMenu(db, {
      name: fam.name,
      slug: fam.slug,
      parent: lrParent,
      brandId: brand._id,
      departmentId: dept?._id || null,
      image: `${BASE}/images/products/${fam.page.split("/").pop().replace(/\.asp$/i, "")}.jpg`,
      order: i + 1,
      level: "subcategory",
    });
    try {
      const html = await fetchHtml(fam.page);
      const parsed = parseFamilyPage(html, fam.name);
      parsed.productRange = await enrichProductRangeDetails(
        parsed.productRange || [],
      );
      familyDocs[fam.slug] = parsed;
      log(
        `Scraped ${fam.name}: imgs=${parsed.images.length} brochures=${parsed.brochures.length} drawings=${parsed.drawingEntries.length} range=${parsed.productRange.length}`,
      );
    } catch (e) {
      log(`FAIL scrape ${fam.name}: ${e.message}`);
      familyDocs[fam.slug] = null;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  // Door canopy submenus
  const doorParent = catIds["door-canopies"];
  for (let i = 0; i < DOOR_CANOPIES.length; i++) {
    const d = DOOR_CANOPIES[i];
    await upsertMenu(db, {
      name: d.name,
      slug: d.slug,
      parent: doorParent,
      brandId: brand._id,
      departmentId: dept?._id || null,
      image: d.image,
      order: i + 1,
      level: "subcategory",
    });
  }

  // 3) Remap existing products + attach family docs
  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .toArray();
  let remapped = 0;
  let enriched = 0;
  for (const p of products) {
    const mapped = mapSkuToFamily(p.name, p.category);
    const famDoc = mapped.subCategory ? familyDocs[mapped.subCategory] : null;
    const $set = {
      category: mapped.category,
      subCategory: mapped.subCategory || "",
      department: dept?.slug || p.department || "roofing",
      updatedAt: new Date(),
      specs: {
        ...(p.specs || {}),
        britmetFamily: mapped.subCategory || mapped.category,
        britmetRevampedAt: new Date().toISOString(),
      },
    };
    if (famDoc) {
      if (famDoc.images?.length) $set.images = famDoc.images;
      if (famDoc.description && (!p.description || p.description.length < 80)) {
        $set.description = famDoc.description;
      }
      if (famDoc.schematicImage) $set.schematicImage = famDoc.schematicImage;
      $set.specs = {
        ...$set.specs,
        ...(famDoc.specs || {}),
        britmetFamily: mapped.subCategory,
        britmetRevampedAt: new Date().toISOString(),
        sourceUrl:
          LR_FAMILIES.find((f) => f.slug === mapped.subCategory)?.page || "",
      };
      $set.brochures = famDoc.brochures || [];
      $set.productRange = famDoc.productRange || [];
      $set.caseStudies = famDoc.caseStudies || [];
      $set.generalSpecification = famDoc.generalSpecification || {
        image: "",
        content: "",
      };
      $set.installerGuides = famDoc.installerGuides || [];
      $set.drawingEntries = famDoc.drawingEntries || [];
      enriched += 1;
    }
    remapped += 1;
    if (!DRY_RUN) {
      await db.collection("products").updateOne({ _id: p._id }, { $set });
    }
  }
  log(`Remapped products=${remapped} enrichedWithFamilyDocs=${enriched}`);

  // 4) Upsert hero products for each LR family (if no product named exactly the family)
  for (const fam of LR_FAMILIES) {
    const doc = familyDocs[fam.slug];
    if (!doc) continue;
    const existing = await db.collection("products").findOne({
      brand: brand._id,
      name: new RegExp(`^${fam.name}$`, "i"),
    });
    const payload = {
      name: fam.name,
      description: doc.description || `${fam.name} by Britmet.`,
      price: existing?.price || 0,
      stock: existing?.stock ?? 50,
      category: "lightweight-roofing",
      subCategory: fam.slug,
      department: dept?.slug || "roofing",
      brand: brand._id,
      images: doc.images?.length ? doc.images : existing?.images || [],
      schematicImage: doc.schematicImage || existing?.schematicImage || "",
      specs: {
        ...(existing?.specs || {}),
        ...doc.specs,
        source: "britmet-site",
        sourceUrl: fam.page,
        britmetFamily: fam.slug,
        britmetRevampedAt: new Date().toISOString(),
      },
      showSpecs: true,
      brochures: doc.brochures,
      productRange: doc.productRange,
      caseStudies: doc.caseStudies,
      generalSpecification: doc.generalSpecification,
      installerGuides: doc.installerGuides,
      drawingEntries: doc.drawingEntries,
      updatedAt: new Date(),
    };
    if (DRY_RUN) {
      log(`[dry] upsert hero ${fam.name}`);
      continue;
    }
    if (existing) {
      await db.collection("products").updateOne({ _id: existing._id }, { $set: payload });
      log(`Updated hero ${fam.name}`);
    } else {
      await db.collection("products").insertOne({
        ...payload,
        createdAt: new Date(),
        isOutOfStock: false,
        downloads: [],
        filesDocumentation: [],
        featureEntries: [],
        packingEntries: [],
        colorOptions: [],
      });
      log(`Created hero ${fam.name}`);
    }
  }

  // 5) Upsert door canopy products
  for (const d of DOOR_CANOPIES) {
    const existing = await db.collection("products").findOne({
      brand: brand._id,
      name: new RegExp(d.name.replace(/^The\s+/i, ""), "i"),
    });
    const payload = {
      name: d.name,
      description: `${d.name} door canopy by Britmet.`,
      price: existing?.price || 0,
      stock: existing?.stock ?? 50,
      category: "door-canopies",
      subCategory: d.slug,
      department: dept?.slug || "roofing",
      brand: brand._id,
      images: [d.image],
      specs: {
        ...(existing?.specs || {}),
        source: "britmet-site",
        sourceUrl: `${BASE}/door-canopies.asp`,
        britmetFamily: d.slug,
      },
      updatedAt: new Date(),
    };
    if (DRY_RUN) continue;
    if (existing) {
      await db.collection("products").updateOne({ _id: existing._id }, { $set: payload });
    } else {
      await db.collection("products").insertOne({
        ...payload,
        createdAt: new Date(),
        showSpecs: true,
        isOutOfStock: false,
        brochures: [],
        productRange: [],
        caseStudies: [],
        generalSpecification: { image: "", content: "" },
        installerGuides: [],
        drawingEntries: [],
      });
    }
    log(`Door canopy ${d.name}`);
  }

  // 6) Scrape paint + tactray + flat-to-pitch hubs onto a hero product each
  const hubs = [
    {
      name: "Paint",
      category: "paint",
      subCategory: "",
      page: `${BASE}/paint.asp`,
    },
    {
      name: "TacTray 90",
      category: "structural-trays",
      subCategory: "",
      page: `${BASE}/tactray90.asp`,
    },
    {
      name: "Flat To Pitch",
      category: "flat-to-pitch-solutions",
      subCategory: "",
      page: `${BASE}/flat-to-pitch-roof-solutions.asp`,
    },
  ];
  for (const hub of hubs) {
    try {
      const html = await fetchHtml(hub.page);
      const imgs = imgsIn(html).filter((u) => /products\//i.test(u)).slice(0, 12);
      const pdfs = linksIn(html)
        .filter((u) => /\.pdf/i.test(u))
        .slice(0, 10)
        .map((url) => ({
          name: path.basename(decodeURIComponent(url)).slice(0, 80),
          url,
        }));
      const desc =
        cleanText(
          (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ||
            [])[1] || "",
        ) || cleanText((html.match(/<p[^>]*>([\s\S]{80,500}?)<\/p>/i) || [])[1] || "");
      const existing = await db.collection("products").findOne({
        brand: brand._id,
        name: new RegExp(`^${hub.name}$`, "i"),
      });
      const payload = {
        name: hub.name,
        description: desc || `${hub.name} by Britmet.`,
        price: existing?.price || 0,
        stock: existing?.stock ?? 50,
        category: hub.category,
        subCategory: hub.subCategory,
        department: dept?.slug || "roofing",
        brand: brand._id,
        images: imgs.length ? imgs : existing?.images || [],
        brochures: pdfs,
        specs: {
          ...(existing?.specs || {}),
          source: "britmet-site",
          sourceUrl: hub.page,
        },
        updatedAt: new Date(),
      };
      if (!DRY_RUN) {
        if (existing) {
          await db.collection("products").updateOne({ _id: existing._id }, { $set: payload });
        } else {
          await db.collection("products").insertOne({
            ...payload,
            createdAt: new Date(),
            showSpecs: true,
            isOutOfStock: false,
            productRange: [],
            caseStudies: [],
            generalSpecification: { image: "", content: "" },
            installerGuides: [],
            drawingEntries: [],
          });
        }
      }
      log(`Hub product ${hub.name} imgs=${imgs.length} pdfs=${pdfs.length}`);
    } catch (e) {
      log(`FAIL hub ${hub.name}: ${e.message}`);
    }
  }

  // Stats
  const activeMenus = await db
    .collection("menus")
    .countDocuments({ brand: brand._id, isActive: true });
  const byCat = await db
    .collection("products")
    .aggregate([
      { $match: { brand: brand._id } },
      {
        $group: {
          _id: { c: "$category", s: "$subCategory" },
          n: { $sum: 1 },
        },
      },
      { $sort: { "_id.c": 1, "_id.s": 1 } },
    ])
    .toArray();
  log(`Active menus=${activeMenus}`);
  log(`Products by cat/sub: ${JSON.stringify(byCat, null, 2)}`);
  log("Done");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
