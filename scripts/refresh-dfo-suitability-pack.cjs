/**
 * Refresh Direct Flooring Online:
 *  - Room Suitability → product.suitability (image via Cloudinary, or table)
 *  - Pack Coverage + Price Per Pack → specs for the DFO configurator
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-dfo-suitability-pack.cjs
 *   DRY_RUN=1 LIMIT=5 ONLY_URL=https://...
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BRAND_SLUG = "direct-flooring-online";
const CLOUDINARY_FOLDER = "linx-living/products/direct-flooring-online/suitability";
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY_URL = String(process.env.ONLY_URL || "").trim();
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const LOG = path.join(__dirname, "_tmp-dfo-suitability.log");

const imageCache = new Map(); // sourceUrl → cloudinaryUrl

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(html) {
  return String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&pound;/gi, "£")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href, base = "https://directflooringonline.co.uk") {
  let u = String(href || "")
    .trim()
    .split("#")[0];
  if (!u) return "";
  u = u.replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = "https:" + u;
  else if (u.startsWith("/")) u = base + u;
  else if (!/^https?:\/\//i.test(u)) u = `${base}/${u.replace(/^\.\//, "")}`;
  return u;
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

async function uploadRemoteImage(imageUrl) {
  const clean = absUrl(imageUrl);
  if (!clean) return "";
  if (imageCache.has(clean)) return imageCache.get(clean);
  if (SKIP_IMAGES || DRY_RUN) {
    imageCache.set(clean, clean);
    return clean;
  }
  const hash = crypto.createHash("sha1").update(clean).digest("hex").slice(0, 16);
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: `suitability-${hash}`,
    overwrite: true,
    resource_type: "image",
  });
  const url = result.secure_url || result.url || "";
  if (url) imageCache.set(clean, url);
  return url;
}

function parsePackPricing(html) {
  const packPriceRaw =
    (
      html.match(
        /Price\s*Per\s*Pack\s*:?\s*<\/strong>\s*(?:&pound;|£)\s*([0-9]+(?:\.[0-9]+)?)/i,
      ) ||
      html.match(
        /Price\s*Per\s*Pack\s*:?\s*(?:&pound;|£)\s*([0-9]+(?:\.[0-9]+)?)/i,
      ) ||
      []
    )[1] || "";
  const coverageRaw =
    (
      html.match(
        /Pack\s*Coverage\s*:?\s*<\/strong>\s*([0-9]+(?:\.[0-9]+)?)\s*m2/i,
      ) ||
      html.match(/Pack\s*Coverage\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*m2/i) ||
      []
    )[1] || "";
  // PEWC formula often embeds coverage: {field}/1.47
  const formulaCov =
    (
      html.match(
        /pewc-data-formula"\s*value="\{[^}]+\}\\?\/([0-9]+(?:\.[0-9]+)?)"/i,
      ) ||
      html.match(/pewc-data-formula" value="\{field_\d+\}\/([0-9.]+)"/i) ||
      []
    )[1] || "";
  const formulaPack =
    (
      html.match(
        /pewc-data-formula" value="\{field_\d+\}\*([0-9]+(?:\.[0-9]+)?)"/i,
      ) || []
    )[1] || "";

  const packCoverageM2 = Number(coverageRaw || formulaCov) || 0;
  const pricePerPack = Number(packPriceRaw || formulaPack) || 0;
  return { packCoverageM2, pricePerPack };
}

function parseSuitabilityFromHtml(html) {
  // Prefer product-content "Room Suitability" heading followed by an image widget
  // (skip the nav mega-menu occurrence which has nav-menu after the heading).
  const headingRe =
    /<h2[^>]*>\s*Room\s*Suitability\s*<\/h2>([\s\S]{0,4000}?)(?=<h2\b|woocommerce-tabs|<\/section|$)/gi;
  let m;
  while ((m = headingRe.exec(html))) {
    const chunk = m[1] || "";
    if (/nav-menu|elementor-nav-menu/i.test(chunk) && !/<img/i.test(chunk)) {
      continue;
    }
    const img =
      (
        chunk.match(
          /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["'][^"']*Suitabilit[^"']*["'])?/i,
        ) ||
        chunk.match(/src=["']([^"']*Room-Suitabilit[^"']*)["']/i) ||
        chunk.match(/<img[^>]+src=["']([^"']+)["']/i) ||
        []
      )[1] || "";
    if (img && !/logo|icon|svg|spacer/i.test(img)) {
      return { kind: "image", imageUrl: absUrl(img) };
    }
    // Table under heading
    const table = chunk.match(/<table[\s\S]*?<\/table>/i);
    if (table) {
      const rows = [];
      for (const tr of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
        const cells = [
          ...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi),
        ].map((c) => cleanText(c[1]));
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) {
        const hasTh = /<th/i.test(table[0]);
        return {
          kind: "table",
          tableHeadings: hasTh ? rows[0] : [],
          tableRows: hasTh ? rows.slice(1) : rows,
        };
      }
    }
  }

  // Attribute row fallback
  const attr =
    (
      html.match(
        /woocommerce-product-attributes-item--attribute_pa_room_suitability[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i,
      ) || []
    )[1] || "";
  const rooms = cleanText(attr);
  if (rooms) {
    return {
      kind: "table",
      tableHeadings: ["Room Suitability"],
      tableRows: [[rooms]],
    };
  }
  return null;
}

async function main() {
  fs.writeFileSync(LOG, "");
  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({
    $or: [{ slug: BRAND_SLUG }, { name: /direct flooring online/i }],
  });
  if (!brand) throw new Error("Direct Flooring Online brand not found");

  const q = {
    brand: brand._id,
    "specs.sourceUrl": { $regex: /directflooringonline\.co\.uk\/product/i },
  };
  if (ONLY_URL) q["specs.sourceUrl"] = ONLY_URL;

  let products = await db
    .collection("products")
    .find(q, {
      projection: {
        name: 1,
        price: 1,
        specs: 1,
        suitability: 1,
        tagline: 1,
      },
    })
    .toArray();
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  log(
    `Brand=${brand.name} products=${products.length} dryRun=${DRY_RUN} skipImages=${SKIP_IMAGES}`,
  );

  let ok = 0;
  let fail = 0;
  let withImage = 0;
  let withTable = 0;
  let withPack = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const sourceUrl = String(p.specs?.sourceUrl || "").trim();
    if (!sourceUrl) {
      log(`[${i + 1}/${products.length}] SKIP no sourceUrl ${p.name}`);
      continue;
    }
    try {
      const html = await fetchHtml(sourceUrl);
      const pack = parsePackPricing(html);
      const suitRaw = parseSuitabilityFromHtml(html);

      let suitability = {
        type: "",
        image: "",
        tableHeadings: [],
        tableRows: [],
      };
      if (suitRaw?.kind === "image" && suitRaw.imageUrl) {
        const cloud = await uploadRemoteImage(suitRaw.imageUrl);
        if (cloud) {
          suitability = {
            type: "image",
            image: cloud,
            tableHeadings: [],
            tableRows: [],
          };
          withImage += 1;
        }
      } else if (suitRaw?.kind === "table") {
        suitability = {
          type: "table",
          image: "",
          tableHeadings: suitRaw.tableHeadings || [],
          tableRows: suitRaw.tableRows || [],
        };
        withTable += 1;
      } else if (p.specs?.["Room Suitability"]) {
        suitability = {
          type: "table",
          image: "",
          tableHeadings: ["Room Suitability"],
          tableRows: [[String(p.specs["Room Suitability"])]],
        };
        withTable += 1;
      }

      const packCoverageM2 =
        pack.packCoverageM2 ||
        Number(
          String(p.specs?.["Pack Coverage"] || "").replace(/[^0-9.]/g, ""),
        ) ||
        0;

      // Keep storefront pack price aligned with our selling £/m² when possible.
      let pricePerPack = pack.pricePerPack || 0;
      const sellingM2 = Number(p.price) || 0;
      if (packCoverageM2 > 0 && sellingM2 > 0) {
        // Prefer our uplifted selling price for the live configurator.
        pricePerPack = Math.round(sellingM2 * packCoverageM2 * 100) / 100;
      }
      if (packCoverageM2 > 0 && pricePerPack > 0) withPack += 1;

      const specs = {
        ...(p.specs || {}),
        packCoverageM2: packCoverageM2 || undefined,
        sqmPerBox: packCoverageM2 || p.specs?.sqmPerBox,
        pricePerPack: pricePerPack || undefined,
        pricePerM2: sellingM2 || p.specs?.pricePerM2,
        dfoSitePricePerPack: pack.pricePerPack || undefined,
        dfoSuitabilityAt: new Date().toISOString(),
      };
      if (packCoverageM2) {
        specs["Pack Coverage"] = `${packCoverageM2} m2`;
      }

      log(
        `[${i + 1}/${products.length}] ${p.name} | suit=${suitability.type || "none"} | cov=${packCoverageM2 || "-"} | pack£=${pricePerPack || "-"}`,
      );

      if (!DRY_RUN) {
        await db.collection("products").updateOne(
          { _id: p._id },
          {
            $set: {
              suitability,
              specs,
              updatedAt: new Date(),
            },
          },
        );
      }
      ok += 1;
      await new Promise((r) => setTimeout(r, 80));
    } catch (e) {
      fail += 1;
      log(`[${i + 1}/${products.length}] FAIL ${p.name}: ${e.message}`);
    }
  }

  log(
    `Done ok=${ok} fail=${fail} image=${withImage} table=${withTable} withPack=${withPack}`,
  );
  process.exit(fail && !ok ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
