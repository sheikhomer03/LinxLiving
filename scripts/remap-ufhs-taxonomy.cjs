/**
 * Rebuild UFHS brand menus to match https://www.theunderfloorheatingstore.com/
 * main nav → subcategories, then reassign every product.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/remap-ufhs-taxonomy.cjs
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
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
const CLOUDINARY_FOLDER = "linx-living/products/the-under-floor-heating";
const LOG = path.join(__dirname, "_tmp-ufhs-remap.log");
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";

/** Official main nav from theunderfloorheatingstore.com (product taxonomy only). */
const SITE_TREE = [
  {
    handle: "electric-underfloor-heating",
    title: "Electric Underfloor Heating",
    children: [
      ["underfloor-heating-mats", "Underfloor Heating Mats"],
      ["underfloor-heating-cables", "Underfloor Heating Cables"],
      ["underfloor-heating-foil", "Underfloor Heating Foil"],
      ["inscreed-heating", "In Screed Underfloor Heating"],
      ["electric-underfloor-heating-accessories", "Accessories"],
      ["decoupling", "Decoupling Mats"],
      ["electrical", "Electrical Components"],
      ["installation", "Installation Tools"],
      ["thermal-imaging-cameras", "Thermal Imaging Cameras"],
    ],
  },
  {
    handle: "water-underfloor-heating",
    title: "Water Underfloor Heating",
    children: [
      ["low-profile-water-underfloor-heating", "Low Profile Kits"],
      ["standard-output-water-underfloor-heating", "Standard Output Kits"],
      ["high-output-water-underfloor-heating", "High Output Kits"],
      ["multi-room-water-underfloor-heating", "Multi Room Kits"],
      ["water-underfloor-heating-fixing-systems", "Fixing Systems"],
      ["underfloor-heating-pipes", "Pipes"],
      ["underfloor-heating-manifolds", "Manifolds"],
      ["wiring-centres", "Wiring Centres"],
      ["couplings", "Couplings & Valves"],
      ["actuators", "Actuators"],
      ["underfloor-heating-pumps", "Pumps"],
      ["water-underfloor-heating-tools", "Tools"],
      ["thermal-imaging-cameras", "Thermal Imaging Cameras"],
    ],
  },
  {
    handle: "thermostats",
    title: "Thermostats",
    children: [
      ["wifi-thermostats", "WiFi Thermostats"],
      ["touchscreen-thermostats", "Digital Thermostats"],
      ["manual-thermostats", "Manual Dial Thermostats"],
      ["wireless-thermostats", "Wireless Thermostats"],
      ["programmable-thermostats", "Programmable Thermostats"],
      ["hot-water-programmers", "Hot Water Programmers"],
      ["smart-heating", "Smart Heating"],
      ["wiring-centres", "Wiring Centres"],
      ["electric-thermostats", "Electric Underfloor Heating Thermostats"],
      ["water-thermostats", "Water Underfloor Heating Thermostats"],
    ],
  },
  {
    handle: "insulation-fixings",
    title: "Insulation & Fixing Systems",
    children: [
      ["insulation-boards", "Insulation Boards"],
      ["water-underfloor-heating-fixing-systems", "Fixing Systems"],
      ["no-more-ply", "NoMorePly"],
    ],
  },
  {
    handle: "adhesives-levellers",
    title: "Adhesives & Levellers",
    children: [
      ["tile-adhesive", "Tile Adhesives"],
      ["self-levelling-compound", "Self Levelling Compound"],
      ["floor-primer", "Floor Primer"],
      ["grouts", "Tiling Grout"],
      ["spray-adhesives", "Spray Adhesives"],
      ["tiling-tools", "Tiling Tools"],
    ],
  },
  {
    handle: "energy-efficiency",
    title: "Energy Efficiency",
    children: [
      ["air-source-heat-pumps", "Air Source Heat Pump Kits"],
      ["hot-water-cylinders", "Hot Water Cylinders"],
      ["ev-chargers", "EV Chargers"],
      ["water-boilers", "Electric Water Boilers"],
      ["solar-panels", "Solar Thermal (Water)"],
      ["skirting-board-heating", "Skirting Board Heating"],
      ["air-conditioning", "Air Conditioning"],
      ["solar-pv-panels", "Solar PV Panels"],
      ["solar-pv-accessories", "Solar PV Accessories"],
      ["solar-pv-inverter", "Solar PV Inverters"],
      ["solar-pv-storage-units", "Solar PV Storage Units"],
    ],
  },
  {
    handle: "bathrooms",
    title: "Wet Rooms",
    children: [
      ["shower-trays", "Wet Room Shower Trays"],
      ["wetroom-shower-screens", "Wetroom Shower Screens"],
      ["bathroom-wall-panels", "Bathroom Wall Panels"],
      ["tiles", "Tiles"],
      ["wetroom-installation-tools", "Wet Room Installation Tools"],
      ["towel-radiators", "Towel Radiators"],
    ],
  },
  {
    handle: "plumbing",
    title: "Plumbing",
    children: [
      ["plastic-pipe", "Plastic Pipe"],
      ["plastic-connectors-fittings", "Plastic Connectors & Fittings"],
      ["copper-brass-pipe-fittings", "Copper & Brass Connectors & Fittings"],
      ["underfloor-heating-pipes", "Heating Pipe"],
      ["underfloor-heating-manifolds", "Manifolds"],
      ["water-underfloor-heating-tools", "Plumbing Tools"],
    ],
  },
  {
    handle: "pallet-deals",
    title: "Pallet Deals",
    children: [],
  },
];

/** Prefer these parents when a product matches multiple trees. */
const PARENT_PRIORITY = [
  "adhesives-levellers",
  "bathrooms",
  "energy-efficiency",
  "insulation-fixings",
  "pallet-deals",
  "thermostats",
  "electric-underfloor-heating",
  "water-underfloor-heating",
  "plumbing",
];

/** Shared leaves that should prefer a specific parent when present. */
const SHARED_LEAF_PARENT = {
  thermostats: "thermostats",
  "wifi-thermostats": "thermostats",
  "touchscreen-thermostats": "thermostats",
  "manual-thermostats": "thermostats",
  "wireless-thermostats": "thermostats",
  "programmable-thermostats": "thermostats",
  "hot-water-programmers": "thermostats",
  "smart-heating": "thermostats",
  "electric-thermostats": "thermostats",
  "water-thermostats": "thermostats",
  "insulation-boards": "insulation-fixings",
  "no-more-ply": "insulation-fixings",
  "water-underfloor-heating-fixing-systems": "insulation-fixings",
};

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchAllCollections() {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const data = await fetchJson(
      `${BASE}/collections.json?limit=250&page=${page}`,
    );
    const rows = data.collections || [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 250) break;
    page += 1;
  }
  return out;
}

async function fetchCollectionHandles(handle) {
  const set = new Set();
  let page = 1;
  while (page <= 20) {
    try {
      const data = await fetchJson(
        `${BASE}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`,
      );
      const rows = data.products || [];
      if (!rows.length) break;
      for (const p of rows) if (p.handle) set.add(p.handle);
      if (rows.length < 250) break;
      page += 1;
    } catch {
      break;
    }
    await delay(40);
  }
  return set;
}

async function uploadRemoteImage(imageUrl, publicId) {
  if (SKIP_IMAGES || DRY_RUN || !imageUrl) return "";
  const clean = String(imageUrl).split("?")[0];
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: `${CLOUDINARY_FOLDER}/menus`,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      invalidate: true,
      resource_type: "image",
    });
    return result.secure_url;
  } catch (e) {
    log(`image fail ${publicId}: ${e.message}`);
    return "";
  }
}

function buildLeafIndex() {
  /** leafHandle → [{ parent, title, leafTitle, size hint later }] */
  const leafToParents = new Map();
  for (const cat of SITE_TREE) {
    for (const [leaf, leafTitle] of cat.children) {
      if (!leafToParents.has(leaf)) leafToParents.set(leaf, []);
      leafToParents.get(leaf).push({
        parent: cat.handle,
        parentTitle: cat.title,
        leaf,
        leafTitle,
      });
    }
  }
  return leafToParents;
}

function pickAssignment(productHandle, membership, leafSizes) {
  // Marketing collection wins when present
  if (membership.has("pallet-deals")) {
    return { category: "pallet-deals", subCategory: "" };
  }

  // membership: Set of collection handles this product is in
  const leafHits = [];
  for (const [leaf, parents] of buildLeafIndex()) {
    if (!membership.has(leaf)) continue;
    for (const p of parents) {
      leafHits.push({
        ...p,
        size: leafSizes.get(leaf) || 9999,
      });
    }
  }

  if (leafHits.length) {
    // Force shared leaves to preferred parent when that parent is in SITE_TREE
    const forced = leafHits
      .map((h) => {
        const prefer = SHARED_LEAF_PARENT[h.leaf];
        if (prefer) {
          return { ...h, parent: prefer, forced: true };
        }
        return h;
      })
      // dedupe parent+leaf
      .filter(
        (h, i, arr) =>
          arr.findIndex((x) => x.parent === h.parent && x.leaf === h.leaf) ===
          i,
      );

    forced.sort((a, b) => {
      // smaller leaf collection = more specific
      if (a.size !== b.size) return a.size - b.size;
      const pa = PARENT_PRIORITY.indexOf(a.parent);
      const pb = PARENT_PRIORITY.indexOf(b.parent);
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    });

    const best = forced[0];
    return { category: best.parent, subCategory: best.leaf };
  }

  // Parent-only membership
  for (const parent of PARENT_PRIORITY) {
    if (membership.has(parent)) {
      return { category: parent, subCategory: "" };
    }
  }

  return null;
}

async function main() {
  fs.writeFileSync(LOG, `UFHS remap ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  log(`Loading collections from ${BASE}…`);
  const collections = await fetchAllCollections();
  const colByHandle = new Map(collections.map((c) => [c.handle, c]));

  const needed = new Set();
  for (const cat of SITE_TREE) {
    needed.add(cat.handle);
    for (const [h] of cat.children) needed.add(h);
  }

  log(`Fetching membership for ${needed.size} collections…`);
  /** handle → Set(productHandles) */
  const colProducts = new Map();
  const leafSizes = new Map();
  let n = 0;
  for (const h of needed) {
    n += 1;
    const set = await fetchCollectionHandles(h);
    colProducts.set(h, set);
    leafSizes.set(h, set.size);
    log(`  [${n}/${needed.size}] ${h}: ${set.size}`);
  }

  /** productHandle → Set(collection handles) */
  const productMembership = new Map();
  for (const [col, set] of colProducts) {
    for (const ph of set) {
      if (!productMembership.has(ph)) productMembership.set(ph, new Set());
      productMembership.get(ph).add(col);
    }
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("UFHS brand not found");

  const menusCol = db.collection("menus");
  const productsCol = db.collection("products");

  // Upload covers + ensure menus
  const keepMenuIds = new Set();
  const menuBySlug = new Map(); // `${parentId||'root'}:${slug}` → menu
  let order = 0;

  for (const cat of SITE_TREE) {
    const col = colByHandle.get(cat.handle);
    let image = "";
    if (col?.image?.src) {
      image = await uploadRemoteImage(col.image.src, `menu-${cat.handle}`);
    } else {
      // fallback: first product image in collection
      const firstHandle = [...(colProducts.get(cat.handle) || [])][0];
      if (firstHandle) {
        const prod = await productsCol.findOne({
          brand: brand._id,
          "specs.ufhsHandle": firstHandle,
        });
        const src = (prod?.images || []).find((u) => /cloudinary\.com/i.test(u));
        if (src) image = src;
      }
    }

    let parentMenu;
    if (DRY_RUN) {
      parentMenu = { _id: `dry-${cat.handle}`, slug: cat.handle };
      log(`[dry] parent ${cat.title}`);
    } else {
      const existing = await menusCol.findOne({
        brand: brand._id,
        slug: cat.handle,
        parent: null,
      });
      const now = new Date();
      if (existing) {
        await menusCol.updateOne(
          { _id: existing._id },
          {
            $set: {
              name: cat.title,
              order: order++,
              isActive: true,
              image: image || existing.image || "",
              updatedAt: now,
            },
          },
        );
        parentMenu = { ...existing, name: cat.title };
      } else {
        const r = await menusCol.insertOne({
          name: cat.title,
          slug: cat.handle,
          parent: null,
          brand: brand._id,
          order: order++,
          isActive: true,
          image: image || "",
          level: "category",
          createdAt: now,
          updatedAt: now,
        });
        parentMenu = { _id: r.insertedId, slug: cat.handle, name: cat.title };
        log(`Created parent ${cat.title}`);
      }
    }
    keepMenuIds.add(String(parentMenu._id));
    menuBySlug.set(`root:${cat.handle}`, parentMenu);

    let childOrder = 0;
    for (const [leaf, leafTitle] of cat.children) {
      // Skip creating duplicate child under wrong parent when SHARED forces elsewhere
      // Still create the leaf under THIS parent if it's listed in SITE_TREE for this parent
      // Exception: don't create thermostats leaf under electric/water — those aren't in our SITE_TREE as electric children anymore

      const leafCol = colByHandle.get(leaf);
      let childImage = "";
      if (leafCol?.image?.src) {
        childImage = await uploadRemoteImage(
          leafCol.image.src,
          `menu-${cat.handle}-${leaf}`,
        );
      }

      if (DRY_RUN) {
        log(`[dry]   child ${leafTitle} under ${cat.title}`);
        continue;
      }

      const existing = await menusCol.findOne({
        brand: brand._id,
        slug: leaf,
        parent: parentMenu._id,
      });
      const now = new Date();
      if (existing) {
        await menusCol.updateOne(
          { _id: existing._id },
          {
            $set: {
              name: leafTitle,
              order: childOrder++,
              isActive: true,
              image: childImage || existing.image || "",
              level: "subcategory",
              updatedAt: now,
            },
          },
        );
        keepMenuIds.add(String(existing._id));
      } else {
        // If same slug exists under another parent for this brand, still create
        // under this parent (slug uniqueness is per parent+brand in our app)
        const r = await menusCol.insertOne({
          name: leafTitle,
          slug: leaf,
          parent: parentMenu._id,
          brand: brand._id,
          order: childOrder++,
          isActive: true,
          image: childImage || "",
          level: "subcategory",
          createdAt: now,
          updatedAt: now,
        });
        keepMenuIds.add(String(r.insertedId));
        log(`Created child ${leafTitle} → ${cat.title}`);
      }
    }
  }

  // Delete junk / old brand menus not in keep set
  if (!DRY_RUN) {
    const allMenus = await menusCol.find({ brand: brand._id }).toArray();
    let deleted = 0;
    for (const m of allMenus) {
      if (!keepMenuIds.has(String(m._id))) {
        await menusCol.deleteOne({ _id: m._id, brand: brand._id });
        deleted += 1;
        log(`Deleted obsolete menu ${m.name} (${m.slug})`);
      }
    }
    log(`Deleted menus: ${deleted}`);
  }

  // Reassign products
  const products = await productsCol.find({ brand: brand._id }).toArray();
  log(`Reassigning ${products.length} products…`);

  let updated = 0;
  let unmatched = 0;
  const unmatchedList = [];
  const dist = new Map();

  for (const p of products) {
    const handle = p.specs?.ufhsHandle || "";
    const membership = productMembership.get(handle) || new Set();
    let assign = pickAssignment(handle, membership, leafSizes);

    // Fallback: product_type / tags heuristics
    if (!assign) {
      const type = String(p.specs?.productType || "").toLowerCase();
      const tags = (p.specs?.tags || []).map((t) => String(t).toLowerCase());
      const blob = `${p.name} ${type} ${tags.join(" ")}`.toLowerCase();
      if (/thermostat|smart heating|protouch|heatmiser|hive|salus/.test(blob)) {
        assign = { category: "thermostats", subCategory: "" };
      } else if (/adhesive|grout|primer|levell/.test(blob)) {
        assign = { category: "adhesives-levellers", subCategory: "" };
      } else if (/wet room|shower tray|towel radiator|wall panel|tile/.test(blob)) {
        assign = { category: "bathrooms", subCategory: "" };
      } else if (/solar|heat pump|ev charger|cylinder|boiler|skirting|air.?con/.test(blob)) {
        assign = { category: "energy-efficiency", subCategory: "" };
      } else if (/insulation|nomoreply|fixing/.test(blob)) {
        assign = { category: "insulation-fixings", subCategory: "" };
      } else if (/pipe|manifold|plumbing|fitting|connector/.test(blob)) {
        assign = { category: "plumbing", subCategory: "" };
      } else if (/water|wet ufh|manifold|actuator|pump/.test(blob)) {
        assign = { category: "water-underfloor-heating", subCategory: "" };
      } else if (/electric|mat|cable|foil|inscreed/.test(blob)) {
        assign = { category: "electric-underfloor-heating", subCategory: "" };
      } else {
        assign = { category: "electric-underfloor-heating", subCategory: "" };
        unmatched += 1;
        unmatchedList.push(handle || p.name);
      }
    }

    const key = `${assign.category}/${assign.subCategory || "-"}`;
    dist.set(key, (dist.get(key) || 0) + 1);

    if (!DRY_RUN) {
      await productsCol.updateOne(
        { _id: p._id, brand: brand._id },
        {
          $set: {
            category: assign.category,
            subCategory: assign.subCategory || "",
            updatedAt: new Date(),
            "specs.taxonomySource": "ufhs-nav-remap",
          },
        },
      );
    }
    updated += 1;
  }

  log(`\nUpdated products: ${updated}  heuristic/fallback unmatched-ish: ${unmatched}`);
  log("Distribution:");
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(v).padStart(4)}  ${k}`);
  }
  if (unmatchedList.length) {
    log(`Unmatched samples (first 20): ${unmatchedList.slice(0, 20).join(", ")}`);
  }

  // Final menu/product counts
  const menus = await menusCol
    .find({ brand: brand._id })
    .project({ name: 1, slug: 1, parent: 1, image: 1 })
    .toArray();
  const tops = menus.filter((m) => !m.parent);
  const subs = menus.filter((m) => m.parent);
  log(
    `\nDone. menus=${menus.length} tops=${tops.length} subs=${subs.length} products=${products.length}`,
  );
  for (const t of tops) {
    const children = subs.filter(
      (s) => String(s.parent) === String(t._id),
    );
    const count = await productsCol.countDocuments({
      brand: brand._id,
      category: t.slug,
    });
    log(
      `  ${t.name}: ${children.length} subs, ${count} products, image=${t.image ? "yes" : "no"}`,
    );
  }

  await mongoose.disconnect();

  // Bust Next.js navigation cache so Shop by type sees new children
  const revalidateUrl =
    process.env.REVALIDATE_URL ||
    "http://localhost:3000/api/revalidate-navigation";
  try {
    const res = await fetch(revalidateUrl, { method: "POST" });
    log(`Revalidate navigation: HTTP ${res.status}`);
  } catch (e) {
    log(
      `Revalidate skipped (${e.message}). Hit ${revalidateUrl} or restart Next.js.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
