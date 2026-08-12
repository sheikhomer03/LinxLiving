/**
 * Patch existing Spectra Adhesive / Grout / Silicone products:
 * - colour options (Colourfast 360)
 * - clear bad sizeOptions that stored colours
 * - specs.larsenKind
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/patch-spectra-larsen.cjs
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

const BASE = "https://spectratileandhome.com";
const DRY_RUN = process.env.DRY_RUN === "1";
const LOG = path.join(__dirname, "_tmp-patch-spectra-larsen.log");

const LARSEN_SWATCHES = {
  White:
    "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-white.png?v=88835890003184620621785026914",
  "Silver Grey":
    "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-silver-grey.png?v=102083703330948050851785026914",
  Anthracite:
    "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-anthracite.png?v=66478849338952892781785026914",
  Grey: "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-grey.png?v=138758975870253432561785026914",
  Limestone:
    "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-limestone.png?v=104127842257014441861785026914",
  Beige:
    "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-beige.png?v=174942164673656263931785026914",
  Black:
    "https://spectratileandhome.com/cdn/shop/t/9/assets/larsen-grout-black.png?v=163861959402005032281785026914",
};

const LARSEN_COLOUR_HEX = {
  White: "#f4f4f2",
  "Silver Grey": "#a7a7a7",
  Anthracite: "#3a3a3a",
  Grey: "#7b7b7b",
  Limestone: "#cfc6b8",
  Beige: "#d4c4a8",
  Black: "#1a1a1a",
};

const COLOUR_NAMES = new Set(
  Object.keys(LARSEN_SWATCHES).map((n) => n.toLowerCase()),
);

function log(msg) {
  const line = `${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG, line);
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function inferLarsenKind(name, handle) {
  const hay = `${handle || ""} ${name || ""}`.toLowerCase();
  if (/silicone/.test(hay)) return "silicone";
  if (/grout/.test(hay)) return "grout";
  if (/adhesive/.test(hay)) return "adhesive";
  return "";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    https
      .get(url, { headers: { "user-agent": "LinxLiving-patch/1.0" } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return fetchJson(res.headers.location).then(resolve, reject);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function extractColourOptions(shopify, fallbackImage) {
  const opt = (shopify.options || []).find((o) =>
    /colou?r/i.test(String(o.name || "")),
  );
  if (!opt) return [];
  const variants = shopify.variants || [];
  const images = shopify.images || [];
  const out = [];
  for (const [index, value] of (opt.values || []).entries()) {
    const name = String(value || "").trim();
    if (!name || /^default title$/i.test(name)) continue;
    const variant =
      variants.find(
        (v) =>
          String(v.option1 || v.title || "").trim().toLowerCase() ===
          name.toLowerCase(),
      ) || variants[index];
    const imageId = variant?.image_id;
    let imageUrl = fallbackImage || "";
    if (imageId) {
      const img = images.find((i) => String(i.id) === String(imageId));
      if (img?.src) imageUrl = absUrl(img.src);
    }
    const swatchImage = LARSEN_SWATCHES[name] || "";
    out.push({
      name,
      swatchType: swatchImage ? "image" : "solid",
      colorValue: LARSEN_COLOUR_HEX[name] || "#cccccc",
      swatchImage,
      imageUrl,
      sap: String(variant?.sku || ""),
      sortOrder: index,
    });
  }
  return out;
}

function extractSizeName(shopify) {
  const opt = (shopify.options || []).find((o) =>
    /size/i.test(String(o.name || "")),
  );
  if (!opt) return "";
  const v = String(opt.values?.[0] || "").trim();
  return v && !/^default title$/i.test(v) ? v : "";
}

async function main() {
  fs.writeFileSync(LOG, `patch-spectra-larsen ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "spectra" });
  if (!brand) throw new Error("Spectra brand not found");

  const products = await db
    .collection("products")
    .find({ brand: brand._id, category: "adhesive-grout-silicone" })
    .toArray();

  log(`Found ${products.length} adhesive-grout-silicone products`);

  for (const product of products) {
    const handle = String(product.specs?.spectraHandle || "").trim();
    const name = product.name || "";
    let shopify = null;
    if (handle) {
      try {
        shopify = await fetchJson(`${BASE}/products/${handle}.js`);
      } catch (e) {
        log(`  ! fetch failed ${handle}: ${e.message}`);
      }
    }

    const larsenKind =
      inferLarsenKind(name, handle) ||
      String(product.specs?.larsenKind || "").trim();
    const fallbackImage = Array.isArray(product.images)
      ? product.images[0] || ""
      : "";
    const colorOptions = shopify
      ? extractColourOptions(shopify, fallbackImage)
      : Array.isArray(product.colorOptions)
        ? product.colorOptions
        : [];

    // Fallback Colourfast colours when Shopify fetch fails but kind needs them.
    const colours =
      colorOptions.length > 0
        ? colorOptions
        : larsenKind === "grout" || larsenKind === "silicone"
          ? Object.keys(LARSEN_SWATCHES).map((cName, index) => ({
              name: cName,
              swatchType: "image",
              colorValue: LARSEN_COLOUR_HEX[cName],
              swatchImage: LARSEN_SWATCHES[cName],
              imageUrl: fallbackImage,
              sap: "",
              sortOrder: index,
            }))
          : [];

    const sizeName = shopify ? extractSizeName(shopify) : "";
    let sizeOptions = [];
    if (sizeName) {
      sizeOptions = [
        { name: sizeName, imageUrl: fallbackImage, sortOrder: 0 },
      ];
    } else if (Array.isArray(product.sizeOptions)) {
      sizeOptions = product.sizeOptions.filter(
        (s) => !COLOUR_NAMES.has(String(s?.name || "").toLowerCase()),
      );
    }

    const specs = {
      ...(product.specs || {}),
      larsenKind: larsenKind || undefined,
      size: sizeName || (larsenKind === "adhesive" ? "20kg" : ""),
      unit: "each",
    };
    if (!specs.larsenKind) delete specs.larsenKind;

    const $set = {
      colorOptions: colours,
      sizeOptions,
      specs,
      updatedAt: new Date(),
    };

    log(
      `${DRY_RUN ? "[dry] " : ""}${name} kind=${larsenKind || "?"} colours=${colours.length} sizes=${sizeOptions.map((s) => s.name).join(",") || "-"}`,
    );

    if (!DRY_RUN) {
      await db.collection("products").updateOne({ _id: product._id }, { $set });
    }
  }

  await mongoose.disconnect();
  log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
