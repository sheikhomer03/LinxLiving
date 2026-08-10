/**
 * Report every department, category, subcategory and product with no image —
 * or with an image that cannot actually be loaded.
 *
 * Taxonomy: Department -> Category -> Subcategory -> Product.
 * Categories/subcategories live in `menus` (parent: null = category).
 *
 * Usage:
 *   node scripts/audit-missing-images.cjs                 # empty images only (fast)
 *   node scripts/audit-missing-images.cjs --check-urls    # also HEAD every distinct URL
 *   node scripts/audit-missing-images.cjs --limit=500     # cap products scanned
 *   node scripts/audit-missing-images.cjs --json=out.json # write full report
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { connectMongo } = require("./mongo-connect.cjs");

const CHECK_URLS = process.argv.includes("--check-urls");
const LIMIT = Number(
  (process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0,
);
const JSON_OUT = (process.argv.find((a) => a.startsWith("--json=")) || "").split("=")[1];
const CONCURRENCY = 12;

/** Blank, whitespace, or a known placeholder. */
function isEmptyImage(value) {
  const v = String(value || "").trim();
  return !v || v === "-" || /^(null|undefined)$/i.test(v);
}

/** A value that will 404 in production: root-relative path into uncommitted public/. */
function isLocalPath(value) {
  return /^\/[^\s?#]+\.(jpe?g|png|webp|avif|gif|svg)$/i.test(String(value || "").trim());
}

/** HEAD (falling back to ranged GET) to see whether an image really loads. */
async function urlLoads(url) {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
      });
    }
    const type = res.headers.get("content-type") || "";
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    if (type && !type.startsWith("image/")) return { ok: false, reason: `type ${type}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.cause?.code || e.message };
  }
}

/** Resolve a map of url -> result with bounded concurrency. */
async function checkAll(urls, onProgress) {
  const results = new Map();
  const queue = [...urls];
  let done = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      results.set(url, await urlLoads(url));
      if (++done % 50 === 0) onProgress?.(done, urls.length);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;

  const brands = await db.collection("brands").find({}).toArray();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  const brandName = (id) =>
    id ? brandById.get(String(id))?.name || brandById.get(String(id))?.slug || "?" : "—";

  // ---- Departments -------------------------------------------------------
  const departments = await db.collection("departments").find({}).toArray();
  const deptIssues = departments
    .filter((d) => isEmptyImage(d.image) || isLocalPath(d.image))
    .map((d) => ({
      type: "department",
      name: d.name || d.title || d.slug,
      slug: d.slug,
      id: String(d._id),
      image: d.image || "",
      issue: isEmptyImage(d.image) ? "empty" : "local-path",
    }));

  // ---- Categories & subcategories (menus) --------------------------------
  const menus = await db.collection("menus").find({}).toArray();
  const menuById = new Map(menus.map((m) => [String(m._id), m]));

  const menuIssues = [];
  for (const m of menus) {
    const empty = isEmptyImage(m.image);
    if (!empty && !isLocalPath(m.image)) continue;
    const isCategory = !m.parent;
    menuIssues.push({
      type: isCategory ? "category" : "subcategory",
      brand: brandName(m.brand),
      parent: isCategory
        ? "—"
        : menuById.get(String(m.parent))?.name ||
          menuById.get(String(m.parent))?.slug ||
          "?",
      name: m.name || m.title || m.slug,
      slug: m.slug,
      id: String(m._id),
      image: m.image || "",
      issue: empty ? "empty" : "local-path",
    });
  }

  // ---- Products ----------------------------------------------------------
  const productQuery = db
    .collection("products")
    .find({}, { projection: { name: 1, sku: 1, images: 1, brand: 1, department: 1, category: 1, subCategory: 1 } });
  if (LIMIT) productQuery.limit(LIMIT);

  const productIssues = [];
  let productCount = 0;
  const productUrls = new Set();
  const productsByUrl = new Map();

  for await (const p of productQuery) {
    productCount++;
    const images = Array.isArray(p.images) ? p.images.filter((i) => !isEmptyImage(i)) : [];
    const local = images.filter(isLocalPath);

    if (!images.length) {
      productIssues.push({
        type: "product",
        name: p.name,
        sku: p.sku || "",
        brand: brandName(p.brand),
        department: p.department || "",
        category: p.category || "",
        subCategory: p.subCategory || "",
        id: String(p._id),
        issue: "no-images",
        image: "",
      });
    } else if (local.length) {
      productIssues.push({
        type: "product",
        name: p.name,
        sku: p.sku || "",
        brand: brandName(p.brand),
        department: p.department || "",
        category: p.category || "",
        subCategory: p.subCategory || "",
        id: String(p._id),
        issue: "local-path",
        image: local[0],
      });
    }

    if (CHECK_URLS && images.length) {
      const cover = images[0];
      productUrls.add(cover);
      if (!productsByUrl.has(cover)) productsByUrl.set(cover, []);
      productsByUrl.get(cover).push(p);
    }
  }

  // ---- Optional reachability pass ---------------------------------------
  let brokenMenus = [];
  let brokenProducts = [];
  if (CHECK_URLS) {
    const menuUrls = new Set(
      menus
        .map((m) => String(m.image || "").trim())
        .filter((u) => /^https?:\/\//i.test(u)),
    );
    const deptUrls = new Set(
      departments
        .map((d) => String(d.image || "").trim())
        .filter((u) => /^https?:\/\//i.test(u)),
    );
    const all = [...new Set([...menuUrls, ...deptUrls, ...productUrls])].filter((u) =>
      /^https?:\/\//i.test(u),
    );

    console.log(`\nChecking ${all.length} distinct image URLs…`);
    const results = await checkAll(all, (d, t) =>
      process.stdout.write(`  ${d}/${t}\r`),
    );
    console.log(`  ${all.length}/${all.length} checked`);

    for (const m of menus) {
      const r = results.get(String(m.image || "").trim());
      if (r && !r.ok) {
        brokenMenus.push({
          type: m.parent ? "subcategory" : "category",
          brand: brandName(m.brand),
          name: m.name || m.slug,
          slug: m.slug,
          id: String(m._id),
          image: m.image,
          issue: `unreachable (${r.reason})`,
        });
      }
    }
    for (const [url, prods] of productsByUrl) {
      const r = results.get(url);
      if (r && !r.ok) {
        for (const p of prods) {
          brokenProducts.push({
            type: "product",
            name: p.name,
            sku: p.sku || "",
            brand: brandName(p.brand),
            category: p.category || "",
            subCategory: p.subCategory || "",
            id: String(p._id),
            image: url,
            issue: `unreachable (${r.reason})`,
          });
        }
      }
    }
  }

  // ---- Report ------------------------------------------------------------
  const line = "=".repeat(72);
  const section = (title, rows, render) => {
    console.log(`\n${line}\n${title}  (${rows.length})\n${line}`);
    if (!rows.length) {
      console.log("  none");
      return;
    }
    rows.forEach(render);
  };

  section("DEPARTMENTS missing images", deptIssues, (d) =>
    console.log(`  [${d.issue}] ${d.name}  (slug: ${d.slug})`),
  );

  const cats = menuIssues.filter((m) => m.type === "category");
  const subs = menuIssues.filter((m) => m.type === "subcategory");

  section("CATEGORIES missing images", cats, (c) =>
    console.log(`  [${c.issue}] ${c.brand} › ${c.name}  (slug: ${c.slug})${c.image ? `\n      ${c.image}` : ""}`),
  );

  section("SUBCATEGORIES missing images", subs, (s) =>
    console.log(`  [${s.issue}] ${s.brand} › ${s.parent} › ${s.name}  (slug: ${s.slug})${s.image ? `\n      ${s.image}` : ""}`),
  );

  section("PRODUCTS missing images", productIssues, (p) =>
    console.log(
      `  [${p.issue}] ${p.brand} › ${p.category || "?"}${p.subCategory ? ` › ${p.subCategory}` : ""} › ${p.name}${p.sku ? `  (${p.sku})` : ""}`,
    ),
  );

  if (CHECK_URLS) {
    section("CATEGORIES / SUBCATEGORIES with unreachable images", brokenMenus, (m) =>
      console.log(`  [${m.issue}] ${m.brand} › ${m.name}\n      ${m.image}`),
    );
    section("PRODUCTS with unreachable cover image", brokenProducts, (p) =>
      console.log(`  [${p.issue}] ${p.brand} › ${p.name}${p.sku ? ` (${p.sku})` : ""}\n      ${p.image}`),
    );
  }

  console.log(`\n${line}\nSUMMARY\n${line}`);
  console.log(`Departments    : ${deptIssues.length} / ${departments.length} missing`);
  console.log(`Categories     : ${cats.length} / ${menus.filter((m) => !m.parent).length} missing`);
  console.log(`Subcategories  : ${subs.length} / ${menus.filter((m) => m.parent).length} missing`);
  console.log(`Products       : ${productIssues.length} / ${productCount} missing`);
  if (CHECK_URLS) {
    console.log(`Unreachable    : ${brokenMenus.length} menus, ${brokenProducts.length} products`);
  }

  if (JSON_OUT) {
    const out = path.isAbsolute(JSON_OUT) ? JSON_OUT : path.join(__dirname, "..", JSON_OUT);
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          generatedFor: process.env.CLOUDINARY_CLOUD_NAME,
          departments: deptIssues,
          categories: cats,
          subcategories: subs,
          products: productIssues,
          unreachableMenus: brokenMenus,
          unreachableProducts: brokenProducts,
        },
        null,
        2,
      ),
    );
    console.log(`\nFull report: ${out}`);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
