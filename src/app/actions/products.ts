"use server";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { isShopifyStorefrontEnabled } from "@/lib/shopify";

export interface ProductFilters {
  category?: string | string[];
  /** Brand slug(s) — match product.brand ObjectId only (never name / shared category). */
  brand?: string | string[];
  /** Optional Brand.subBrands[].slug — match product.subBrand */
  subBrand?: string | string[];
  /** LINX department slug(s) — Department → Category → Subcategory */
  department?: string | string[];
  /**
   * When true with `department`, only match product.department (no menu-token OR).
   * Use for Configurator so mis-tagged / unrelated SKUs do not leak in.
   */
  departmentStrict?: boolean;
  /** Tile size(s) from specs.size (e.g. 600x600) */
  size?: string | string[];
  /**
   * When set with a parent `category`, requires both:
   * product.category = parent AND product.subCategory = this value.
   * Avoids slug collisions (e.g. fixed-frameless under pitched vs flat).
   */
  subCategory?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  search?: string;
  page?: number;
  limit?: number;
  fields?: string; // e.g. "name price images shopifyImages category"
  /** Skip countDocuments when total/pages are unused (e.g. mega-menu). */
  skipCount?: boolean;
  /** Optional: category/subCategory slugs owned by selected brand(s) */
  brandCategorySlugs?: string[];
  /** Only products with at least one gallery image (mega-menu cards). */
  requireImages?: boolean;
  /** Only products with a Cloudinary (non-Shopify CDN) gallery image. */
  requireCloudinary?: boolean;
  /** Facet: stock status */
  stockStatus?: string | string[];
  /** Facet: material / colour / finish / style (arrays + specs.*) */
  material?: string | string[];
  colour?: string | string[];
  finish?: string | string[];
  /** Style / finish / Floor Style from specs (navbar Style column) */
  style?: string | string[];
  /** Facet: collection / range name from specs (navbar Range column) */
  range?: string | string[];
  /** Only products currently on sale (specs.salePercent > 0). */
  onSale?: boolean;
}

function asList(value?: string | string[]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Brand ObjectIds hidden from the storefront (inactive / HIDDEN_BRAND_SLUGS). */
async function getExcludedStorefrontBrandIds(): Promise<unknown[]> {
  const { getExcludedStorefrontBrandIds: load } = await import(
    "@/lib/excludedStorefrontBrands"
  );
  return load();
}

/**
 * When Storefront catalog is enabled, overlay live Shopify price/stock only.
 * Images stay on Mongo/Cloudinary — Shopify CDN hotlinks often 404 and break next/image.
 */
async function enrichFromStorefront(products: any[]) {
  if (!isShopifyStorefrontEnabled() || !products.length) return products;

  try {
    const { fetchStorefrontProductById } = await import("@/lib/shopify/storefront");
    return Promise.all(
      products.map(async (product) => {
        if (!product.shopifyProductId) return product;
        try {
          const sf = await fetchStorefrontProductById(product.shopifyProductId);
          if (!sf) return product;
          const mongoPrice = Number(product.price);
          const hasMongoPrice = Number.isFinite(mongoPrice) && mongoPrice > 0;
          return {
            ...product,
            name: sf.title || product.name,
            description: sf.description || product.description,
            // Keep the catalogue price when Mongo already has one. Shopify
            // storefront often carries a sale/promotional figure that would
            // incorrectly overwrite list prices (e.g. Spectra).
            price: hasMongoPrice ? product.price : (sf.price ?? product.price),
            stock:
              typeof sf.totalInventory === "number"
                ? sf.totalInventory
                : product.stock,
            // Keep product.images (Cloudinary) — do not replace with Shopify CDN URLs
            shopifyVariantId: sf.variantId || product.shopifyVariantId,
            category: sf.productType || product.category,
          };
        } catch {
          return product;
        }
      }),
    );
  } catch {
    return products;
  }
}

/**
 * Catalogue listing for a product page's "What's Trending" / related strip.
 *
 * Same result for every product in a department and changes only with the
 * catalogue, but it ran per product view at ~680ms. Cached under the shared
 * "navigation" tag, which admin edits already clear. Same query, same output.
 */
export async function getRelatedListing(opts: {
  department?: string;
  category?: string;
  subCategory?: string;
  sort?: string;
  limit: number;
  fields: string;
}) {
  return cachedRelatedListing(opts);
}

const cachedRelatedListing = unstable_cache(
  async (opts: {
    department?: string;
    category?: string;
    subCategory?: string;
    sort?: string;
    limit: number;
    fields: string;
  }) => getPublicProducts({ sort: "newest", ...opts, skipCount: true }),
  ["related-listing"],
  { revalidate: 300, tags: ["navigation"] },
);

/**
 * Menu slugs and names that belong to a set of departments.
 *
 * Four round trips — the departments, their menus, those menus' children, and
 * every other department — to build one list of strings. They ran in sequence
 * on every catalogue request, which on a remote cluster is most of a second
 * before the product query could start, for navigation data that changes when
 * someone edits a menu.
 *
 * Cached under the same "navigation" tag the rest of this file's menu reads
 * use, so editing a menu still clears it. The two reads that do not depend on
 * each other now run together, so a cache miss costs three trips, not four.
 */
const menuTokensForDepartments = unstable_cache(
  async (deptSlugs: string[]): Promise<string[]> => {
    if (!deptSlugs.length) return [];
    const { Department } = await import("@/models/Department");
    const { Menu } = await import("@/models/Menu");

    const deptDocs = await Department.find({
      slug: { $in: deptSlugs },
      isActive: true,
    })
      .select("_id slug")
      .lean();
    const deptIds = deptDocs.map((d: any) => d._id);
    if (!deptIds.length) return [];

    // `otherDepts` needs only the ids, so it does not have to wait behind the
    // menu tree.
    const [menus, otherDepts] = await Promise.all([
      Menu.find({ department: { $in: deptIds }, isActive: { $ne: false } })
        .select("_id slug name parent")
        .lean(),
      Department.find({ isActive: true, _id: { $nin: deptIds } })
        .select("slug name")
        .lean(),
    ]);

    const parentIds = menus.map((m: any) => m._id);
    const children = parentIds.length
      ? await Menu.find({
          parent: { $in: parentIds },
          isActive: { $ne: false },
        })
          .select("slug name")
          .lean()
      : [];

    // Generic bucket names (e.g. "Accessories", "General") repeat as a nested
    // submenu under almost every fixture — Basins > Accessories, Shower >
    // Accessories — and one of them also happens to be another department's
    // own slug/name. Used as a flat category-equality fallback, that collision
    // sweeps the OTHER department's untagged products (e.g. flooring trims
    // filed under category "accessories") into this one. Drop any token that
    // belongs to a different department so the fallback only matches names
    // distinctive enough to belong here — but keep it when it is this same
    // department's own identifier (Accessories browsing Accessories must still
    // work).
    const otherDepartmentTokens = new Set(
      otherDepts
        .flatMap((d: any) => [d.slug, d.name])
        .filter(Boolean)
        .map((v: string) => String(v).trim().toLowerCase()),
    );

    return [
      ...new Set(
        [...menus, ...children]
          .flatMap((m: any) => [m.slug, m.name])
          .filter(Boolean)
          .map((v: string) => String(v))
          .filter((v) => !otherDepartmentTokens.has(v.trim().toLowerCase())),
      ),
    ];
  },
  ["listing-menu-tokens"],
  { revalidate: 300, tags: ["navigation"] },
);

export async function getPublicProducts(filters: ProductFilters = {}) {
  try {
    await connectDB();
    const {
      category,
      brand,
      subBrand,
      department,
      departmentStrict = false,
      size,
      subCategory,
      brandCategorySlugs,
      minPrice,
      maxPrice,
      sort,
      search,
      page = 1,
      limit = 36,
      fields,
      skipCount = false,
      requireImages = false,
      requireCloudinary = false,
      stockStatus,
      material,
      colour,
      range,
      finish,
      style,
      onSale = false,
    } = filters;

    // No main category → not Active (hidden from storefront)
    const and: any[] = [
      { category: { $exists: true, $nin: [null, ""] } },
    ];

    // Only products that carry a price and a photograph are listed
    // (see lib/pricedOnly).
    {
      const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
      const visible = storefrontVisibilityClause();
      if (Object.keys(visible).length) and.push(visible);
    }

    if (requireImages) {
      and.push({ "images.0": { $exists: true } });
      // A handful of products (likewisefloors source) carry a placeholder
      // "no photo available" .svg where a real image would go — that's a
      // non-empty images[0], so it slips past the check above. SVG is never
      // a genuine product photo, so filtering it out here excludes those
      // listings too. Read-only query filter — no product data is touched.
      // Literal RegExp, not `{ $regex, $options }` — Mongo rejects the
      // operator form inside `$not` (Location51091) and throws the query.
      and.push({ "images.0": { $not: /\.svg($|\?)/i } });
    }

    if (requireCloudinary) {
      and.push({
        images: {
          $elemMatch: {
            $regex: "cloudinary\\.com",
            $options: "i",
          },
        },
      });
    }

    // Hide inactive + intentionally hidden brands (e.g. Sterlingbuild)
    {
      const excludedIds = await getExcludedStorefrontBrandIds();
      if (excludedIds.length) {
        and.push({ brand: { $nin: excludedIds } });
      }
    }

    const cats = asList(category).filter((c) => c !== "all");
    const subCats = asList(subCategory).filter(Boolean);

    // Parent + subcategory (scoped) — preferred for type tiles.
    // Also match specs.ufhsCollections / specs.naturaCollections so shared
    // Shopify leaves still list products when the product's primary category
    // was filed under a different parent.
    // `category`/`subCategory` hold one slug each, which cannot describe a
    // supplier that cross-lists — a Plank hook belongs to Hooks & Accessories
    // and to cabinet hardware at once. The full membership lives in
    // `categories[]`/`subCategories[]`, so both are matched alongside the
    // primaries; a catalogue that only ever set the primaries is unaffected.
    const matchSub = (slug: string) => ({
      $or: [
        { subCategory: slug },
        { subCategories: slug },
        { "specs.ufhsCollections": slug },
        { "specs.naturaCollections": slug },
      ],
    });
    if (cats.length === 1 && subCats.length === 1) {
      and.push(matchSub(subCats[0]));
    } else if (subCats.length === 1 && cats.length === 0) {
      and.push(matchSub(subCats[0]));
    } else if (cats.length === 1) {
      and.push({
        $or: [
          { category: cats[0] },
          { categories: cats[0] },
          { subCategory: cats[0] },
          { subCategories: cats[0] },
          { "specs.ufhsCollections": cats[0] },
          { "specs.naturaCollections": cats[0] },
        ],
      });
    } else if (cats.length > 1) {
      and.push({
        $or: [
          { category: { $in: cats } },
          { categories: { $in: cats } },
          { subCategory: { $in: cats } },
          { subCategories: { $in: cats } },
          { "specs.ufhsCollections": { $in: cats } },
          { "specs.naturaCollections": { $in: cats } },
        ],
      });
    }

    const brandSlugs = asList(brand);
    // Strict brand ownership: product.brand ObjectId only.
    // Do not OR category menu slugs or match on product name ("FAKRO …").
    if (brandSlugs.length) {
      const { Brand } = await import("@/models/Brand");
      const brandDocs = await Brand.find({
        slug: { $in: brandSlugs },
        isActive: true,
      })
        .select("_id")
        .lean();
      const brandIds = brandDocs.map((b: any) => b._id);
      if (brandIds.length) {
        and.push({ brand: { $in: brandIds } });
      } else {
        and.push({ _id: { $in: [] } });
      }
    } else if ((brandCategorySlugs || []).filter(Boolean).length) {
      // Legacy path when no brand slug is selected — category menus only.
      // Still excludes hidden brands via $nin above.
      const menuSlugs = (brandCategorySlugs || []).filter(Boolean);
      and.push({
        $or: [
          { category: { $in: menuSlugs } },
          { subCategory: { $in: menuSlugs } },
        ],
      });
    }

    const subBrandSlugs = asList(subBrand)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (subBrandSlugs.length) {
      and.push(
        subBrandSlugs.length === 1
          ? { subBrand: subBrandSlugs[0] }
          : { subBrand: { $in: subBrandSlugs } },
      );
    }

    const deptSlugs = asList(department);
    if (deptSlugs.length) {
      if (departmentStrict) {
        // Configurator / precise views — only explicitly tagged products
        and.push(
          deptSlugs.length === 1
            ? { department: deptSlugs[0] }
            : { department: { $in: deptSlugs } },
        );
      } else {
        // Catalogue: Department → Menus → Products, plus product.department
        const menuTokens = await menuTokensForDepartments(deptSlugs);

        const deptOr: any[] = [{ department: { $in: deptSlugs } }];
        if (menuTokens.length) {
          // The menu-slug fallback exists for products that were never given
          // a department. It must NOT override one that has been set, or a
          // slug shared by two brands drags products across departments —
          // FAKRO files loft ladders under "wooden", Pooky files table lamps
          // the same way, so Electrical was listing loft ladders.
          const untagged = {
            $or: [
              { department: "" },
              { department: null },
              { department: { $exists: false } },
            ],
          };
          deptOr.push(
            { $and: [untagged, { category: { $in: menuTokens } }] },
            { $and: [untagged, { subCategory: { $in: menuTokens } }] },
          );
        }
        and.push({ $or: deptOr });
      }
    }

    const sizes = asList(size);
    if (sizes.length === 1) {
      and.push({
        $or: [{ "specs.size": sizes[0] }, { "specs.Size": sizes[0] }],
      });
    } else if (sizes.length > 1) {
      and.push({
        $or: [
          { "specs.size": { $in: sizes } },
          { "specs.Size": { $in: sizes } },
        ],
      });
    }

    const stockStatuses = asList(stockStatus);
    if (stockStatuses.length === 1) {
      and.push({ stockStatus: stockStatuses[0] });
    } else if (stockStatuses.length > 1) {
      and.push({ stockStatus: { $in: stockStatuses } });
    }

    const materials = asList(material);
    if (materials.length === 1) {
      and.push({ materials: materials[0] });
    } else if (materials.length > 1) {
      and.push({ materials: { $in: materials } });
    }

    const colours = asList(colour);
    if (colours.length) {
      and.push({
        $or: [
          { colours: colours.length === 1 ? colours[0] : { $in: colours } },
          {
            "specs.Colour":
              colours.length === 1 ? colours[0] : { $in: colours },
          },
          {
            "specs.Color":
              colours.length === 1 ? colours[0] : { $in: colours },
          },
          {
            "specs.colour":
              colours.length === 1 ? colours[0] : { $in: colours },
          },
          {
            "specs.COLOUR":
              colours.length === 1 ? colours[0] : { $in: colours },
          },
          {
            "specs.color":
              colours.length === 1 ? colours[0] : { $in: colours },
          },
        ],
      });
    }

    const ranges = asList(range);
    if (ranges.length) {
      const match = ranges.length === 1 ? ranges[0] : { $in: ranges };
      and.push({
        $or: [
          // The schema field first — it is the indexed, canonical home for a
          // range, and what a supplier import should be filling. The specs.*
          // spellings stay for the scrapes that only ever wrote a spec key.
          { rangeName: match },
          { "specs.range": match },
          { "specs.Range": match },
          { "specs.RANGE": match },
          { "specs.collection": match },
        ],
      });
    }

    const finishes = asList(finish);
    if (finishes.length === 1) {
      and.push({
        $or: [
          { finish: finishes[0] },
          { "specs.finish": finishes[0] },
          { "specs.Finish": finishes[0] },
          { "specs.FINISH": finishes[0] },
        ],
      });
    } else if (finishes.length > 1) {
      and.push({
        $or: [
          { finish: { $in: finishes } },
          { "specs.finish": { $in: finishes } },
          { "specs.Finish": { $in: finishes } },
          { "specs.FINISH": { $in: finishes } },
        ],
      });
    }

    const styles = asList(style);
    if (styles.length) {
      const one = styles.length === 1;
      const v = one ? styles[0] : { $in: styles };
      and.push({
        $or: [
          { "specs.Style": v },
          { "specs.style": v },
          { "specs.finish": v },
          { "specs.Finish": v },
          { "specs.FINISH": v },
          { "specs.Floor Style": v },
          { finish: v },
        ],
      });
    }

    if (onSale) {
      and.push({ "specs.salePercent": { $gt: 0 } });
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const price: Record<string, number> = {};
      if (minPrice !== undefined) price.$gte = minPrice;
      if (maxPrice !== undefined) price.$lte = maxPrice;
      and.push({ price });
    }

    if (search) {
      // Escape regex metacharacters so user input is treated literally
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: escaped, $options: "i" };
      // Match whole phrase OR every token (so "Quartz White 60x90" hits name/size)
      const tokens = escaped
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1);
      const tokenClauses = tokens.map((token) => ({
        $or: [
          { name: { $regex: token, $options: "i" } },
          { sku: { $regex: token, $options: "i" } },
          { productCode: { $regex: token, $options: "i" } },
          { barcode: { $regex: token, $options: "i" } },
          { category: { $regex: token, $options: "i" } },
          { subCategory: { $regex: token, $options: "i" } },
          { "specs.size": { $regex: token, $options: "i" } },
        ],
      }));
      and.push({
        $or: [
          { name: rx },
          { sku: rx },
          { productCode: rx },
          { barcode: rx },
          { category: rx },
          { subCategory: rx },
          { department: rx },
          { "specs.size": rx },
          ...(tokenClauses.length > 1 ? [{ $and: tokenClauses }] : []),
        ],
      });
    }

    const query = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };

    let sortOption: any = { createdAt: -1 };
    if (sort === "price-asc") sortOption = { price: 1 };
    if (sort === "price-desc") sortOption = { price: -1 };
    if (sort === "name-asc") sortOption = { name: 1 };
    if (sort === "name-desc") sortOption = { name: -1 };
    if (sort === "newest") sortOption = { createdAt: -1 };

    // Default browsing (no explicit sort picked) leads with a handful of the
    // highest-priced matches, then falls back to the normal newest-first
    // order for everything after — a merchandising ask to put a few premium
    // items up top before the regular listing continues. Any explicit sort
    // (price/name/newest) bypasses this and behaves exactly as before.
    const isDefaultSort = !sort;
    // The lead pool now spans the first 3 pages rather than only page 1 —
    // sized off `limit` so it stays exactly 3 pages regardless of page size.
    const LEAD_PAGE_COUNT = 3;
    const HIGH_PRICE_LEAD_COUNT = limit * LEAD_PAGE_COUNT;
    // Heating only: Featured leads with every Water Underfloor Heating kit
    // before anything else, grouped Low profile → Standard output → High
    // output → Multi-room. Scoped to a heating-only browse (not combined
    // with other departments) so no other listing's Featured order changes.
    const isHeatingOnly = deptSlugs.length === 1 && deptSlugs[0] === "heating";
    const UFH_KIT_SUBCATEGORY_ORDER = [
      "low-profile-water-underfloor-heating",
      "standard-output-water-underfloor-heating",
      "high-output-water-underfloor-heating",
      "multi-room-water-underfloor-heating",
    ];

    let productsRaw: any[];
    let total: number;

    if (isDefaultSort) {
      let ufhKitDocs: any[] = [];
      if (isHeatingOnly) {
        const ufhKitQuery = { $and: [query, { category: "water-underfloor-heating" }] };
        let ufhKitQueryBuilder = Product.find(ufhKitQuery).lean();
        if (fields) ufhKitQueryBuilder = ufhKitQueryBuilder.select(fields);
        ufhKitDocs = (await ufhKitQueryBuilder).sort((a: any, b: any) => {
          const rankOf = (d: any) => {
            const i = UFH_KIT_SUBCATEGORY_ORDER.indexOf(String(d.subCategory || ""));
            return i === -1 ? UFH_KIT_SUBCATEGORY_ORDER.length : i;
          };
          const byRank = rankOf(a) - rankOf(b);
          return byRank !== 0 ? byRank : String(a._id).localeCompare(String(b._id));
        });
      }
      const ufhKitIds = ufhKitDocs.map((d: any) => d._id);

      // `_id` tiebreaker makes this deterministic across the separate
      // lead-page and rest-page requests — without it, price ties could let
      // Mongo return a slightly different top-N each time, which would
      // duplicate or drop a product between pages.
      // Accessory-flagged items never lead, even at a high price — the
      // premium slots are for feature products.
      const leadOnlyQuery = {
        $and: [
          query,
          { isAccessoryItem: { $ne: true } },
          ...(ufhKitIds.length ? [{ _id: { $nin: ufhKitIds } }] : []),
        ],
      };
      let leadQuery = Product.find(leadOnlyQuery)
        .sort({ price: -1, _id: 1 })
        .limit(HIGH_PRICE_LEAD_COUNT)
        .lean();
      if (fields) leadQuery = leadQuery.select(fields);
      const leadDocs = [...ufhKitDocs, ...(await leadQuery)];
      const leadPageCount = isHeatingOnly
        ? Math.ceil(leadDocs.length / limit)
        : LEAD_PAGE_COUNT;

      if (page <= leadPageCount) {
        const start = (page - 1) * limit;
        productsRaw = leadDocs.slice(start, start + limit);
        total = skipCount ? -1 : await Product.countDocuments(query);
      } else {
        const leadIds = leadDocs.map((d: any) => d._id);
        // Accessory-flagged items are excluded here (not sorted-last in
        // Mongo) — sorting on isAccessoryItem has no supporting index once
        // the department/menu-token $or is in the query, and large skips
        // then force a blocking in-memory sort that Atlas's shared tiers
        // reject even with allowDiskUse. Keeping the sort key exactly
        // `createdAt` keeps every page on the existing indexed plan; the
        // excluded items are appended below only once this page's normal
        // pool runs dry, which naturally lands them on the last page(s).
        const restQuery = {
          $and: [query, { _id: { $nin: leadIds } }, { isAccessoryItem: { $ne: true } }],
        };
        const skip = (page - 1 - leadPageCount) * limit;
        let restProductsQuery = Product.find(restQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
        if (fields) restProductsQuery = restProductsQuery.select(fields);
        const [restDocs, cnt] = await Promise.all([
          restProductsQuery,
          skipCount ? Promise.resolve(-1) : Product.countDocuments(query),
        ]);
        productsRaw = restDocs;
        total = cnt;

        if (productsRaw.length < limit) {
          const accessoryQuery = {
            $and: [query, { _id: { $nin: leadIds } }, { isAccessoryItem: true }],
          };
          const nonAccessoryTotal = await Product.countDocuments(restQuery);
          const accessorySkip = Math.max(0, skip - nonAccessoryTotal);
          const need = limit - productsRaw.length;
          let accessoryQueryBuilder = Product.find(accessoryQuery)
            .sort({ createdAt: -1 })
            .skip(accessorySkip)
            .limit(need)
            .lean();
          if (fields) accessoryQueryBuilder = accessoryQueryBuilder.select(fields);
          const accessoryDocs = await accessoryQueryBuilder;
          productsRaw = [...productsRaw, ...accessoryDocs];
        }
      }
    } else {
      let productsQuery = Product.find(query)
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      if (fields) {
        productsQuery = productsQuery.select(fields);
      }

      const [docs, cnt] = await Promise.all([
        productsQuery,
        skipCount ? Promise.resolve(-1) : Product.countDocuments(query),
      ]);
      productsRaw = docs;
      total = cnt;
    }

    // List queries skip full Shopify enrich for speed, but products with
    // Mongo price £0 or stock 0 still linked to Shopify would incorrectly
    // show "TBC" / "Out of stock" while the PDP (enriched) looks fine.
    // Overlay live price/stock only for that subset on the current page.
    let products = productsRaw as any[];
    const needsEnrich = products.filter((p) => {
      if (!p?.shopifyProductId) return false;
      const price = Number(p.price);
      const stock = Number(p.stock);
      const priceMissing = !Number.isFinite(price) || price <= 0;
      const stockMissing = !Number.isFinite(stock) || stock <= 0;
      return priceMissing || stockMissing;
    });
    if (needsEnrich.length) {
      const enriched = await enrichFromStorefront(needsEnrich);
      const byId = new Map(
        enriched.map((p: any) => [String(p._id || p.id), p]),
      );
      products = products.map((p) => byId.get(String(p._id)) || p);
    }

    const resolvedTotal = skipCount
      ? products.length
      : total;

    return {
      products: serialize(products),
      total: resolvedTotal,
      page,
      limit,
      totalPages: skipCount ? 1 : Math.ceil(total / limit),
    };
  } catch (error) {
    console.error("Failed to fetch public products:", error);
    return {
      products: [],
      total: 0,
      page: 1,
      limit: 12,
      totalPages: 0,
    };
  }
}

/**
 * Cart upsell: what actually goes with what is already in the basket.
 *
 * Matching on category alone put another gloss tile next to a gloss tile and
 * never the adhesive, grout or trim the job needs. This pairs each department
 * with the fitting materials it genuinely requires, taken from ranges that
 * have priced stock — a suggestion the customer cannot buy is worse than none.
 */
const COMPANION_CATEGORIES: Record<string, string[]> = {
  tiles: [
    "adhesives-levellers",
    "adhesive-grout-silicone",
    "mb-accessories",
  ],
  flooring: [
    "adhesives-levellers",
    "insulation-fixings",
    "mb-accessories",
  ],
  "wall-panels": ["adhesives-levellers", "mb-accessories"],
  bathrooms: ["adhesives-levellers", "mb-accessories"],
  heating: ["insulation-fixings", "adhesives-levellers"],
  "rooflights-and-glass": ["flashings", "blinds-accessories"],
  roofing: ["flashings", "mb-accessories"],
};

export type CartRecommendationInput = {
  /** Categories represented in the basket. */
  categories: string[];
  /** Product ids already in the basket. */
  excludeIds: string[];
  limit?: number;
};

/**
 * Companion products first, then more of the same category.
 *
 * Companions lead because they are the things a customer forgets — you can
 * lay a floor without a second floor, but not without adhesive.
 */
export async function getCartRecommendations({
  categories,
  excludeIds,
  limit = 6,
}: CartRecommendationInput) {
  try {
    await connectDB();
    const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
    const excludedBrandIds = await getExcludedStorefrontBrandIds();

    // This module has no top-level mongoose import — `connectDB` returns the
    // connection cache, not the library.
    const { Types } = (await import("mongoose")).default;
    const exclude = (excludeIds || [])
      // Configured cart lines carry composite ids like "<id>::4m2".
      .map((id) => String(id).split("::")[0])
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const base: Record<string, unknown> = {
      ...storefrontVisibilityClause(),
      images: { $exists: true, $ne: [] },
      ...(exclude.length ? { _id: { $nin: exclude } } : {}),
      ...(excludedBrandIds.length
        ? { brand: { $nin: excludedBrandIds } }
        : {}),
    };

    const select =
      "name price images shopifyImages category subCategory department stock shopifyVariantId specs";

    // Cart lines carry a category but not a department, so derive it here
    // rather than widen the cart store and leave existing baskets without it.
    const departments = categories.length
      ? ((await Product.distinct("department", {
          $or: [
            { category: { $in: categories } },
            { subCategory: { $in: categories } },
          ],
        })) as string[]).filter(Boolean)
      : [];

    const companionCats = [
      ...new Set(departments.flatMap((d) => COMPANION_CATEGORIES[d] || [])),
    ].filter((c) => !categories.includes(c));

    // Scoped to the cart's own department(s) so a category slug reused across
    // departments cannot pull in a product from a department the shopper never
    // touched.
    const departmentScope = departments.length
      ? { department: { $in: departments } }
      : {};

    /**
     * Companions need the Accessories department as well as the cart's own.
     *
     * Every companion category — adhesives-levellers, adhesive-grout-silicone,
     * mb-accessories, insulation-fixings, flashings — sits in `accessories`,
     * never in tiles or flooring. Scoping them to the cart's department asked
     * for an adhesive filed under Tiles, matched nothing every time, and left
     * the basket recommending a second tile: a substitute where a complement
     * was intended. The category list is already chosen per department, so
     * widening by this one department cannot pull in anything unrelated.
     */
    const companionScope = departments.length
      ? { department: { $in: [...departments, "accessories"] } }
      : {};

    const [companions, sameCategory] = await Promise.all([
      companionCats.length
        ? Product.find({
            ...base,
            ...companionScope,
            category: { $in: companionCats },
          })
            .select(select)
            .populate("brand", "name slug")
            .limit(limit * 2)
            .lean()
        : Promise.resolve([]),
      (categories || []).length
        ? Product.find({
            ...base,
            ...departmentScope,
            $or: [
              { category: { $in: categories } },
              { subCategory: { $in: categories } },
            ],
          })
            .select(select)
            .populate("brand", "name slug")
            .limit(limit * 2)
            .lean()
        : Promise.resolve([]),
    ]);

    // Companions first, then same-category, deduped.
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const list of [companions, sameCategory]) {
      for (const p of list as { _id: unknown }[]) {
        const id = String(p._id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(p);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }

    return serialize(out);
  } catch (error) {
    console.error("Failed to build cart recommendations:", error);
    return [];
  }
}

export async function getProductsByCategory(
  categoryName: string,
  limit?: number,
) {
  try {
    await connectDB();
    const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
    let query = Product.find({
      category: { $exists: true, $nin: [null, ""] },
      // Recommendation rails are storefront listings like any other — without
      // this the cart and wishlist suggested unpriced and imageless products
      // that no category page would show.
      ...storefrontVisibilityClause(),
      $or: [{ category: categoryName }, { subCategory: categoryName }],
    })
      .sort({ createdAt: -1 })
      // department decides whether a line is sold by the m²; brand and specs
      // decide which configurator it needs. Without them the cart
      // recommendations showed a pack price with no unit and an Add button
      // that dropped "1" of a tile into the basket.
      .select(
        "name price images shopifyImages category subCategory department stock shopifyVariantId specs",
      )
      .populate("brand", "name slug");
    if (limit) query = query.limit(limit);
    const products = await query.lean();
    return serialize(products);
  } catch (error) {
    console.error("Failed to fetch products by category:", error);
    return [];
  }
}

/** Deduped per request (metadata + page share one Mongo read). */
export const getPublicProduct = cache(async (id: string) => {
  // A malformed id (stale link, composite cart-line id, bot probe) is a
  // routine 404, not an application error — skip the query entirely so it
  // never reaches Mongoose as a CastError.
  if (!mongoose.isValidObjectId(id)) return null;
  try {
    await connectDB();
    const product = await Product.findById(id).lean();
    if (!product) return null;
    if (!String((product as any).category || "").trim()) return null;

    // Hidden / inactive brand products are not public
    const brandId = (product as any).brand;
    if (brandId) {
      const excluded = await getExcludedStorefrontBrandIds();
      if (excluded.some((eid) => String(eid) === String(brandId))) {
        return null;
      }
    }

    const [enriched] = await enrichFromStorefront([product as any]);
    return serialize(enriched);
  } catch (error) {
    console.error("Failed to fetch public product:", error);
    return null;
  }
});

/**
 * One Cloudinary cover image per brand (for Shop by Brand tiles when brand.image is empty/broken).
 */
export async function getBrandCoverImages(brandIds: string[]) {
  try {
    await connectDB();
    const ids = brandIds
      .filter((id) => Boolean(id))
      .map((id) => {
        try {
          const mongoose = require("mongoose");
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!ids.length) return {} as Record<string, string>;

    const rows = await Product.aggregate<{ _id: unknown; images: string[] }>([
      {
        $match: {
          brand: { $in: ids },
          category: { $exists: true, $nin: [null, ""] },
          images: {
            $elemMatch: { $regex: "cloudinary\\.com", $options: "i" },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          _id: "$brand",
          images: { $first: "$images" },
        },
      },
    ]);

    const { getProductDisplayImage } = await import("@/lib/productImage");
    const map: Record<string, string> = {};
    for (const row of rows) {
      const url = getProductDisplayImage(row.images);
      if (url) map[String(row._id)] = url;
    }
    return map;
  } catch (error) {
    console.error("getBrandCoverImages:", error);
    return {} as Record<string, string>;
  }
}

/**
 * Facet counts for catalogue filters.
 * Cached ~2 min per brand scope. Aggregations run in parallel (was sequential
 * + N brand countDocuments — the main catalogue lag).
 */
export async function getCatalogFacetCounts(input?: {
  brands?: { slug: string; name: string; categorySlugs: string[] }[];
  categories?: { slug: string; name: string }[];
  /** When set, category / subcategory / size counts are limited to these brand slug(s). */
  brand?: string | string[];
  /** Optional sub-brand slug(s) further scoping facet counts. */
  subBrand?: string | string[];
}) {
  const brandKey = asList(input?.brand)
    .map((s) => s.toLowerCase())
    .sort()
    .join(",");
  const subBrandKey = asList(input?.subBrand)
    .map((s) => s.toLowerCase())
    .sort()
    .join(",");
  try {
    return await cachedCatalogFacetCounts(brandKey, subBrandKey);
  } catch (error) {
    console.error("Failed to fetch catalog facets:", error);
    return emptyFacetCounts();
  }
}

function emptyFacetCounts() {
  return {
    sizeCounts: {} as Record<string, number>,
    categoryCounts: {} as Record<string, number>,
    subcategoryCounts: {} as Record<string, number>,
    subcategoryScopedCounts: {} as Record<string, number>,
    brandCounts: {} as Record<string, number>,
    fromPriceByCategory: {} as Record<string, number>,
    fromPriceBySubcategory: {} as Record<string, number>,
    maxPrice: 0,
  };
}

const cachedCatalogFacetCounts = (brandKey: string, subBrandKey = "") =>
  unstable_cache(
    async () => computeCatalogFacetCounts(brandKey, subBrandKey),
    ["catalog-facet-counts-v34", brandKey || "all", subBrandKey || "all"],
    { revalidate: 120, tags: ["navigation"] },
  )();

async function computeCatalogFacetCounts(brandKey: string, subBrandKey = "") {
  await connectDB();
  const excludedIds = await getExcludedStorefrontBrandIds();
  const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
  const pricedClause = storefrontVisibilityClause();
  const { Brand: BrandModel } = await import("@/models/Brand");

  const base: Record<string, unknown> = {
    category: { $exists: true, $nin: [null, ""] },
    ...(excludedIds.length ? { brand: { $nin: excludedIds } } : {}),
    ...(pricedClause || {}),
  };

  const brandSlugs = brandKey ? brandKey.split(",").filter(Boolean) : [];
  let scopedBase: Record<string, unknown> = base;
  if (brandSlugs.length) {
    const brandDocs = await BrandModel.find({
      slug: { $in: brandSlugs },
      isActive: true,
    })
      .select("_id")
      .lean();
    const brandIds = brandDocs.map((b: any) => b._id);
    scopedBase = brandIds.length
      ? {
          category: { $exists: true, $nin: [null, ""] },
          brand: { $in: brandIds },
          ...(pricedClause || {}),
        }
      : {
          category: { $exists: true, $nin: [null, ""] },
          brand: { $in: [] },
        };
  }

  const subBrandSlugs = subBrandKey
    ? subBrandKey.split(",").filter(Boolean)
    : [];
  if (subBrandSlugs.length) {
    scopedBase = {
      ...scopedBase,
      ...(subBrandSlugs.length === 1
        ? { subBrand: subBrandSlugs[0] }
        : { subBrand: { $in: subBrandSlugs } }),
    };
  }

  const [
    sizeAgg,
    categoryAgg,
    subCategoryAgg,
    fromPriceAgg,
    ufhsAgg,
    naturaAgg,
    brandAgg,
    maxPriceRow,
    allBrands,
  ] = await Promise.all([
    Product.aggregate<{ _id: string; count: number }>([
      { $match: scopedBase },
      { $group: { _id: "$specs.size", count: { $sum: 1 } } },
    ]),
    Product.aggregate<{ _id: string; count: number }>([
      { $match: scopedBase },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
    Product.aggregate<{
      _id: { category: string; sub: string };
      count: number;
    }>([
      {
        $match: {
          ...scopedBase,
          subCategory: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $group: {
          _id: { category: "$category", sub: "$subCategory" },
          count: { $sum: 1 },
        },
      },
    ]),
    Product.aggregate<{
      _id: { category: string; sub: string | null; box: string | null };
      min: number;
    }>([
      {
        $match: {
          ...scopedBase,
          price: { $gt: 0 },
          "specs.sqmPerBox": { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $group: {
          _id: {
            category: "$category",
            sub: "$subCategory",
            box: "$specs.sqmPerBox",
          },
          min: { $min: "$price" },
        },
      },
    ]),
    Product.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          ...scopedBase,
          "specs.ufhsCollections.0": { $exists: true },
        },
      },
      { $unwind: "$specs.ufhsCollections" },
      { $group: { _id: "$specs.ufhsCollections", count: { $sum: 1 } } },
    ]),
    Product.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          ...scopedBase,
          "specs.naturaCollections.0": { $exists: true },
        },
      },
      { $unwind: "$specs.naturaCollections" },
      { $group: { _id: "$specs.naturaCollections", count: { $sum: 1 } } },
    ]),
    // One aggregation for all brand counts (was N× countDocuments)
    Product.aggregate<{ _id: unknown; count: number }>([
      { $match: base },
      { $group: { _id: "$brand", count: { $sum: 1 } } },
    ]),
    Product.findOne(scopedBase).sort({ price: -1 }).select("price").lean(),
    BrandModel.find({ isActive: true }).select("name slug _id").lean(),
  ]);

  const brandLabels = new Set(
    allBrands.flatMap((b: any) =>
      [b.name, b.slug]
        .filter(Boolean)
        .map((v: string) => String(v).trim().toLowerCase()),
    ),
  );
  const isBrandLabel = (v: unknown) =>
    brandLabels.has(String(v || "").trim().toLowerCase());

  const sizeCounts: Record<string, number> = {};
  for (const row of sizeAgg) {
    if (row._id) sizeCounts[String(row._id)] = row.count;
  }

  const categoryCounts: Record<string, number> = {};
  for (const row of categoryAgg) {
    if (row._id && !isBrandLabel(row._id)) {
      categoryCounts[String(row._id)] = row.count;
    }
  }

  const subcategoryCounts: Record<string, number> = {};
  const subcategoryScopedCounts: Record<string, number> = {};
  for (const row of subCategoryAgg) {
    const parent = row._id?.category;
    const sub = row._id?.sub;
    if (!sub || isBrandLabel(sub)) continue;
    subcategoryCounts[String(sub)] =
      (subcategoryCounts[String(sub)] || 0) + row.count;
    if (parent) {
      subcategoryScopedCounts[`${parent}::${sub}`] = row.count;
    }
  }

  for (const row of [...ufhsAgg, ...naturaAgg]) {
    const slug = String(row._id || "");
    if (!slug || isBrandLabel(slug)) continue;
    subcategoryCounts[slug] = Math.max(
      subcategoryCounts[slug] || 0,
      row.count,
    );
    categoryCounts[slug] = Math.max(categoryCounts[slug] || 0, row.count);
  }

  const countByBrandId = new Map(
    brandAgg.map((r) => [String(r._id || ""), r.count]),
  );
  const brandCounts: Record<string, number> = {};
  for (const b of allBrands as any[]) {
    brandCounts[b.slug] = countByBrandId.get(String(b._id)) || 0;
  }

  const maxPrice = Number((maxPriceRow as any)?.price) || 0;

  const { pricePerSqmFrom } = await import("@/lib/tileCalculator");
  const fromPriceByCategory: Record<string, number> = {};
  const fromPriceBySubcategory: Record<string, number> = {};
  for (const row of fromPriceAgg) {
    const cat = row._id?.category ? String(row._id.category) : "";
    const sub = row._id?.sub ? String(row._id.sub) : "";
    const min = pricePerSqmFrom(Number(row.min), row._id?.box);
    if (!Number.isFinite(min) || min <= 0) continue;
    if (cat && !isBrandLabel(cat)) {
      fromPriceByCategory[cat] =
        fromPriceByCategory[cat] > 0
          ? Math.min(fromPriceByCategory[cat], min)
          : min;
    }
    if (sub && !isBrandLabel(sub)) {
      fromPriceBySubcategory[sub] =
        fromPriceBySubcategory[sub] > 0
          ? Math.min(fromPriceBySubcategory[sub], min)
          : min;
    }
  }

  return serialize({
    sizeCounts,
    categoryCounts,
    subcategoryCounts,
    subcategoryScopedCounts,
    brandCounts,
    fromPriceByCategory,
    fromPriceBySubcategory,
    maxPrice,
  });
}

/** Primary images for cart/wishlist sync — same as product page hero. */
export async function getProductsDisplayImages(ids: string[]) {
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return { success: true, images: {} as Record<string, string> };

    await connectDB();
    const { getProductDisplayImage } = await import("@/lib/productImage");
    const products = await Product.find({ _id: { $in: unique } })
      .select("images shopifyImages")
      .lean();

    const images: Record<string, string> = {};
    for (const product of products as any[]) {
      images[product._id.toString()] = getProductDisplayImage(product.images);
    }

    return { success: true, images };
  } catch (error) {
    console.error("Failed to fetch product display images:", error);
    return { success: false, images: {} as Record<string, string> };
  }
}

/**
 * Home page "range bands": for each department, its entry price and a few
 * products to show alongside it.
 *
 * Area-sold ranges (tiles, flooring) report a per-m² rate derived from the box
 * price, so the band reads "Prices from £23.99 m²" the way the trade expects;
 * everything else reports its plain unit price.
 */
/**
 * Homepage range bands.
 *
 * Identical on every visit and changes only when the catalogue changes, but it
 * ran per request and cost ~27s: one price-sorted find plus a countDocuments
 * per department, over 18k products. Cached under the shared "navigation" tag
 * so admin edits clear it. Output is unchanged.
 */
export async function getHomeRangeBands(limitPerBand = 4) {
  return cachedHomeRangeBands(limitPerBand);
}

const cachedHomeRangeBands = unstable_cache(
  async (limitPerBand: number) => buildHomeRangeBands(limitPerBand),
  ["home-range-bands"],
  { revalidate: 300, tags: ["navigation"] },
);

/**
 * The homepage's own two product reads.
 *
 * Both return the same thing for every visitor and change only when the
 * catalogue does, but they ran per request — and with the nav trees, range
 * bands and reviews already cached they were the only uncached work left on
 * that render, so between them they set how long a click on "Home" waits.
 * Cached beside the range bands under the shared "navigation" tag, cleared by
 * /api/revalidate-navigation along with the rest.
 */
const cachedHomeNewArrivals = unstable_cache(
  async (limit: number, fields: string) =>
    getPublicProducts({ limit, sort: "newest", fields, skipCount: true }),
  ["home-new-arrivals"],
  { revalidate: 300, tags: ["navigation"] },
);

export async function getHomeNewArrivals(limit: number, fields: string) {
  return cachedHomeNewArrivals(limit, fields);
}

/** Lowest listed price in a department — the figure the hero quotes. */
const cachedCheapestInDepartment = unstable_cache(
  async (department: string) =>
    getPublicProducts({
      department,
      sort: "price-asc",
      limit: 1,
      fields: "price",
      skipCount: true,
    }),
  ["cheapest-in-department"],
  { revalidate: 300, tags: ["navigation"] },
);

export async function getCheapestInDepartment(department: string) {
  return cachedCheapestInDepartment(department);
}

/**
 * The pool behind the homepage's "In real spaces" cards.
 *
 * It used to take the three newest arrivals, which is whatever supplier
 * imported last — so the section ran as three RAK-INGOT recessed niches in a
 * row, each shot a tight crop of a lit slot in a wall. The card prints its own
 * title over the photograph, so it needs a picture with a room in it and a
 * ground the caption can sit on, not the latest SKU.
 *
 * These categories are the ranges photographed as staged pieces — RAK's
 * basins, baths and furniture — which is the look the section is selling.
 */
// Order matters: the first pick becomes the large lead card, so the range
// photographed against a dark ground (the freestanding baths) leads and the
// white-ground furniture shots take the smaller cards.
const INSPIRATION_CATEGORIES = ["bathtub", "basins", "bathroom-furniture"];

const cachedHomeInspiration = unstable_cache(
  async (limit: number) => buildHomeInspiration(limit),
  ["home-inspiration"],
  { revalidate: 300, tags: ["navigation"] },
);

export async function getHomeInspirationProducts(limit = 24) {
  return cachedHomeInspiration(limit);
}

async function buildHomeInspiration(limit: number) {
  try {
    await connectDB();
    const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
    const excludedIds = await getExcludedStorefrontBrandIds();

    // Per category rather than one capped query: `basins` alone holds more
    // than the whole limit, so a flat `$in` returned 24 basins and the three
    // cards were three basins. Each category contributes its own share, and
    // the result is interleaved so the first three picks are three ranges.
    const perCategory = Math.max(4, Math.ceil(limit / INSPIRATION_CATEGORIES.length));
    const byCategory = await Promise.all(
      INSPIRATION_CATEGORIES.map((category) =>
        Product.find({
          category,
          // The card renders the Shopify mirror, so a product without one has
          // nothing to show — filtered here rather than leaving a blank card.
          "shopifyImages.0": { $exists: true },
          ...storefrontVisibilityClause(),
          ...(excludedIds.length ? { brand: { $nin: excludedIds } } : {}),
        })
          .select("name images shopifyImages category department")
          .limit(perCategory)
          .lean(),
      ),
    );

    const interleaved: any[] = [];
    for (let i = 0; i < perCategory; i++) {
      for (const group of byCategory) {
        if (group[i]) interleaved.push(group[i]);
      }
    }

    return serialize(interleaved.slice(0, limit));
  } catch (error) {
    console.error("getHomeInspirationProducts:", error);
    return [] as any[];
  }
}

async function buildHomeRangeBands(limitPerBand = 4) {
  try {
    await connectDB();
    const { Department } = await import("@/models/Department");
    const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
    const { pricePerSqmFrom, isAreaSoldCategory } = await import(
      "@/lib/tileCalculator"
    );
    const { resolveStorefrontUnitPrice } = await import("@/lib/naturaPrice");
    const { hasPaidSampleFlow } = await import("@/lib/priceOnRequest");
    const priced = storefrontVisibilityClause();
    const excludedIds = await getExcludedStorefrontBrandIds();

    /**
     * Departments the homepage does not merchandise.
     *
     * Accessories is a support section — adhesives, trims, fixings. It is
     * large (1,900+ products) so it would otherwise take one of the
     * best-selling rows away from Flooring, Tiles or Bathrooms, which is what
     * a shopper landing on the homepage is actually looking for.
     *
     * Outdoor Living holds 15 products, and the four cheapest — which is what
     * a band leads with — are fence posts, rails and infills photographed as
     * bare components. Accurate, but not a homepage row.
     *
     * Both stay in the navbar and the catalogue; they just do not get a
     * homepage row.
     */
    const HOMEPAGE_EXCLUDED_DEPARTMENTS = new Set([
      "accessories",
      "outdoor-living",
      "roofing",
    ]);

    /**
     * The categories a department leads with on the homepage.
     *
     * A band takes from its whole department, and the cheapest thing in
     * Bathrooms is a £6 urinal waste — so the row filled with wastes, overflow
     * kits and a shower hose instead of baths, basins and taps. Heating did the
     * same with pipe bends and mounting rails. Where a department names
     * showcase categories only those are eligible; every other department is
     * unrestricted, as before.
     *
     * Thermostats and the `shower` category are left out deliberately: they
     * hold controls, hoses and heads rather than the heating and bathroom
     * suites the row is meant to sell.
     */
    const HOMEPAGE_SHOWCASE: Record<
      string,
      { categories?: string[]; subCategories?: string[]; namePattern?: RegExp }
    > = {
      // Shower trays sit in the catch-all `bathrooms` category alongside the
      // wastes and overflow kits, so the category alone cannot single them
      // out — they are picked by name.
      bathrooms: { namePattern: /tray/i, categories: ["shower-trays"] },
      // Spectra owns these four outright (gloss 29/29, matt-carving 18/18,
      // high-gloss 10/10, matt 9/9), so selecting them is selecting Spectra
      // without having to resolve the brand.
      tiles: {
        categories: ["gloss", "matt-carving", "high-gloss", "matt"],
      },
      electrical: { categories: ["wall-lights"] },
      lighting: { categories: ["wall-lights"] },
      heating: { categories: ["water-underfloor-heating"] },
      // Rooflights is priced mid-range across the whole department, so the row
      // landed on FAKRO pitched-window shots where the window is a small render
      // in a large white frame — the tile reads as mostly empty space. These two
      // subcategories are the ones photographed tight in frame throughout, so
      // every tile in the row fills its card.
      "rooflights-and-glass": {
        categories: ["pitched-roof-windows"],
        subCategories: ["centre-pivot", "l-shape-combination"],
      },
    };

    /**
     * Support parts filed inside a showcase category — "Foil Mat Accessories"
     * sits under electric-underfloor-heating. Real products, just not what a
     * homepage row is for.
     */
    const ACCESSORY_SUBCATEGORIES = new Set([
      "accessories",
      "spares",
      "spare-parts",
    ]);
    const ACCESSORY_NAME =
      /\b(accessor(?:y|ies)|waste|overflow kit|spare part|hose|organiser)\b/i;
    const isShowcaseProduct = (p: any) =>
      !ACCESSORY_SUBCATEGORIES.has(String(p?.subCategory || "").toLowerCase()) &&
      !ACCESSORY_NAME.test(String(p?.name || ""));

    const departments = (
      await Department.find({ isActive: true }).sort({ order: 1, name: 1 }).lean()
    ).filter((d: any) => !HOMEPAGE_EXCLUDED_DEPARTMENTS.has(String(d.slug)));

    const bands = await Promise.all(
      departments.map(async (dept: any) => {
        const showcase = HOMEPAGE_SHOWCASE[String(dept.slug)];
        // A department may name categories, a name pattern, or both; with both
        // either one qualifies, so trays filed under the generic `bathrooms`
        // category still reach the row.
        const showcaseClause = showcase
          ? showcase.categories?.length && showcase.namePattern
            ? {
                $or: [
                  { category: { $in: showcase.categories } },
                  { name: showcase.namePattern },
                ],
              }
            : showcase.categories?.length
              ? { category: { $in: showcase.categories } }
              : showcase.namePattern
                ? { name: showcase.namePattern }
                : null
          : null;
        const match: Record<string, unknown> = {
          department: dept.slug,
          ...(showcaseClause
            ? showcaseClause
            : { category: { $exists: true, $nin: [null, ""] } }),
          // Narrows a named category further — Rooflights takes only the
          // pitched-window subcategories whose photography fills the tile.
          ...(showcase?.subCategories?.length
            ? { subCategory: { $in: showcase.subCategories } }
            : {}),
          ...priced,
          ...(excludedIds.length ? { brand: { $nin: excludedIds } } : {}),
        };

        // Two-stage query to avoid MongoDB in-memory sort limitations and properly skip to average price items
        const candidateProducts = await Product.find(match)
          .select("price images name subCategory")
          .lean();

        if (!candidateProducts.length) return null;

        const productCount = candidateProducts.length;

        // A handful of products (likewisefloors source) carry a placeholder
        // "no photo available" .svg where a real image would go — a real
        // photo is never an .svg, so this excludes those homepage rows too.
        const withImagesCandidates = candidateProducts.filter((p: any) => {
          const first = (p.images || [])[0];
          return (
            !!first &&
            !/\.svg($|\?)/i.test(String(first)) &&
            isShowcaseProduct(p)
          );
        });

        const activeCandidates = withImagesCandidates.length ? withImagesCandidates : candidateProducts;

        // Sort in memory by price ascending
        activeCandidates.sort((a: any, b: any) => (Number(a.price) || 0) - (Number(b.price) || 0));

        // Flooring, Tiles and Windows lead on an entry price ("from £X"), so
        // they take the cheapest. Bathrooms used to as well, which is how a £6
        // urinal waste headlined the row; it now takes the middle of its range
        // like Heating, so the band shows what the department is known for.
        const isAveragePriceDept = !["flooring", "tiles", "windows-and-doors"].includes(dept.slug);
        const limitCount = limitPerBand * 4;

        let chosenCandidates = [];
        if (isAveragePriceDept) {
          const skipCount = Math.max(0, Math.floor((activeCandidates.length - limitCount) / 2));
          chosenCandidates = activeCandidates.slice(skipCount, skipCount + limitCount);
        } else {
          chosenCandidates = activeCandidates.slice(0, limitCount);
        }

        const chosenIds = chosenCandidates.map((p: any) => p._id);

        if (dept.slug === "electrical" && chosenIds.length > 4) {
          const temp = chosenIds[0];
          chosenIds[0] = chosenIds[4];
          chosenIds[4] = temp;
        }

        const products = await Product.find({ _id: { $in: chosenIds } })
          .select(
            "name price images shopifyImages category subCategory specs stock brand",
          )
          .populate("brand", "name uiName slug")
          .lean();

        // Maintain the order of chosenIds in the final products list
        const idToIndexMap = new Map(chosenIds.map((id, index) => [String(id), index]));
        products.sort((a, b) => idToIndexMap.get(String(a._id))! - idToIndexMap.get(String(b._id))!);

        const chosen = products.slice(0, limitPerBand);

        const rate = (p: any) => {
          const natura = resolveStorefrontUnitPrice({
            price: Number(p.price) || 0,
            brandSlug: (p.brand as any)?.slug,
            brandName: (p.brand as any)?.name,
            specs: p.specs,
          });
          if (natura.perSqm) return natura;

          const box = p?.specs?.sqmPerBox ?? p?.specs?.sqmperbox;
          const areaSold =
            box != null ||
            isAreaSoldCategory({
              department: dept.slug,
              category: p.category,
              subCategory: p.subCategory,
            });
          return areaSold
            ? { price: pricePerSqmFrom(p.price, box), perSqm: true }
            : { price: Number(p.price) || 0, perSqm: false };
        };

        const rates = products.map(rate).filter((r) => r.price > 0);
        if (!rates.length) return null;
        const from = rates.reduce((a, b) => (a.price <= b.price ? a : b));

        return {
          slug: dept.slug,
          name: dept.name,
          image: dept.image || "",
          fromPrice: from.price,
          perSqm: from.perSqm,
          productCount,
          products: chosen.map((p: any) => {
            const r = rate(p);

            /*
             * Sale sources (first match wins):
             * 1) Raise-then-% mode: price is RAISED actual; salePercent applies off
             * 2) compareAt > price (price already the sale amount)
             * 3) Genuine supplier list vs promotional columns
             */
            const salePct = Number(p?.specs?.salePercent);
            // shopifyCompareAt wins when present, matching the precedence
            // used everywhere else on the site (ProductCard/ProductSection/
            // CategoryTemplate) — suppliers synced from Shopify (Otto Tiles)
            // already carry that field, and the discount migration writes
            // into whichever one already existed on the product.
            const compareAt = Number(
              p?.specs?.shopifyCompareAt ?? p?.specs?.compareAtPrice,
            );
            const saleMode = String(p?.specs?.salePriceMode || "");
            // Was raised, sell stays at original (customer pays original)
            const raiseWasKeepPrice =
              (saleMode === "raise-was-keep-price" ||
                (Number.isFinite(salePct) &&
                  salePct > 0 &&
                  Number.isFinite(compareAt) &&
                  compareAt > Number(p.price))) &&
              saleMode !== "raise-then-percent";

            const raiseThenPercent =
              saleMode === "raise-then-percent" &&
              Number.isFinite(salePct) &&
              salePct > 0;

            const hasCompareSale =
              !raiseWasKeepPrice &&
              !raiseThenPercent &&
              Number.isFinite(salePct) &&
              salePct > 0 &&
              Number.isFinite(compareAt) &&
              compareAt > Number(p.price);

            const list = Number(p?.specs?.priceExVat);
            const promo = Number(
              p?.specs?.promotionalPrice ?? p?.specs?.promotionPrice,
            );
            const hasPromo =
              !raiseWasKeepPrice &&
              !raiseThenPercent &&
              !hasCompareSale &&
              Number.isFinite(list) &&
              Number.isFinite(promo) &&
              promo > 0 &&
              list > 0 &&
              promo < list;

            let price = r.price;
            let wasPrice = 0;
            let discountPercent = 0;

            // Was-price scaling: re-calling rate() with price swapped to
            // compareAt breaks for suppliers with an explicit specs.pricePerM2
            // (Natura, Otto) — that field wins over whatever price is passed
            // in, so the "was" rate silently comes back identical to "now".
            // Scaling r.price by the same was/now ratio works for both box-
            // priced and explicit-per-m2 suppliers, and matches exactly what
            // the old rate() call produced for the box-priced case.
            const scaledWasPrice = (compareAtValue: number) =>
              Number(p.price) > 0
                ? Math.round((r.price * (compareAtValue / Number(p.price))) * 100) / 100
                : rate({ ...p, price: compareAtValue }).price;

            if (raiseWasKeepPrice) {
              // p.price = original (sell); compareAt = raised was
              price = r.price;
              wasPrice = scaledWasPrice(compareAt);
              discountPercent = Math.round(salePct);
            } else if (raiseThenPercent) {
              wasPrice = r.price;
              price =
                Math.round(r.price * (1 - salePct / 100) * 100) / 100;
              discountPercent = Math.round(salePct);
            } else if (hasCompareSale) {
              price = r.price;
              wasPrice = scaledWasPrice(compareAt);
              discountPercent = Math.round(salePct);
            } else if (hasPromo) {
              price = Math.round(r.price * (promo / list) * 100) / 100;
              wasPrice = r.price;
              discountPercent = Math.round((1 - promo / list) * 100);
            }

            return {
              _id: String(p._id),
              name: p.name,
              images: p.images || [],
              // Carried through because the card resolves its image from the
              // Shopify pairing; dropping it here left every band tile blank.
              shopifyImages: p.shopifyImages || [],
              brandName:
                String((p.brand as any)?.uiName || "").trim() ||
                (p.brand as any)?.name ||
                "",
              brandSlug: (p.brand as any)?.slug || "",
              category: p.category || "",
              subCategory: p.subCategory || "",
              stock: typeof p.stock === "number" ? p.stock : 0,
              price,
              wasPrice,
              discountPercent,
              perSqm: r.perSqm,
              size: p.specs?.size ? String(p.specs.size) : "",
              // Otto Tiles-style suppliers charge for their sample (see
              // specs.samplePrice) — the homepage "free sample" badge/CTA
              // must not offer that as free.
              hasPaidSample: hasPaidSampleFlow(p.specs),
            };
          }),
        };
      }),
    );

    return { success: true, bands: serialize(bands.filter(Boolean)) };
  } catch (error) {
    console.error("getHomeRangeBands:", error);
    return { success: false, bands: [] as any[] };
  }
}

/**
 * Live product count per brand, for the storefront brand grid.
 *
 * Brands with nothing purchasable are dropped by the caller rather than shown
 * as links to an empty page — the same rule the catalogue sidebar follows.
 */
export async function getStorefrontBrandCounts(): Promise<
  Record<string, number>
> {
  try {
    await connectDB();
    const { Brand } = await import("@/models/Brand");
    const { storefrontVisibilityClause } = await import("@/lib/pricedOnly");
    const priced = storefrontVisibilityClause();
    const excluded = await getExcludedStorefrontBrandIds();

    const brands = await Brand.find({ isActive: true })
      .select("_id slug")
      .lean();
    const counts: Record<string, number> = {};

    await Promise.all(
      brands.map(async (b: any) => {
        if (excluded.some((id) => String(id) === String(b._id))) {
          counts[b.slug] = 0;
          return;
        }
        counts[b.slug] = await Product.countDocuments({
          brand: b._id,
          category: { $exists: true, $nin: [null, ""] },
          ...priced,
        });
      }),
    );
    return counts;
  } catch (error) {
    console.error("getStorefrontBrandCounts:", error);
    return {};
  }
}
