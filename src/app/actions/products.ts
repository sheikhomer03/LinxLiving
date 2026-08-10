"use server";

import { cache } from "react";
import { unstable_cache } from "next/cache";
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
  fields?: string; // e.g. "name price images category"
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
      limit = 12,
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

    // Only products that carry a price are listed (see lib/pricedOnly).
    {
      const { pricedOnlyClause } = await import("@/lib/pricedOnly");
      const priced = pricedOnlyClause();
      if (priced) and.push(priced);
    }

    if (requireImages) {
      and.push({ "images.0": { $exists: true } });
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
    const matchSub = (slug: string) => ({
      $or: [
        { subCategory: slug },
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
          { subCategory: cats[0] },
          { "specs.ufhsCollections": cats[0] },
          { "specs.naturaCollections": cats[0] },
        ],
      });
    } else if (cats.length > 1) {
      and.push({
        $or: [
          { category: { $in: cats } },
          { subCategory: { $in: cats } },
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
        const { Department } = await import("@/models/Department");
        const { Menu } = await import("@/models/Menu");
        const deptDocs = await Department.find({
          slug: { $in: deptSlugs },
          isActive: true,
        })
          .select("_id slug")
          .lean();
        const deptIds = deptDocs.map((d: any) => d._id);

        let menuTokens: string[] = [];
        if (deptIds.length) {
          const menus = await Menu.find({
            department: { $in: deptIds },
            isActive: { $ne: false },
          })
            .select("_id slug name parent")
            .lean();
          const parentIds = menus.map((m: any) => m._id);
          const children =
            parentIds.length > 0
              ? await Menu.find({
                  parent: { $in: parentIds },
                  isActive: { $ne: false },
                })
                  .select("slug name")
                  .lean()
              : [];
          menuTokens = [
            ...new Set(
              [...menus, ...children]
                .flatMap((m: any) => [m.slug, m.name])
                .filter(Boolean)
                .map((s: string) => String(s)),
            ),
          ];
        }

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

    let productsQuery = Product.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (fields) {
      productsQuery = productsQuery.select(fields);
    }

    const [productsRaw, total] = await Promise.all([
      productsQuery,
      skipCount
        ? Promise.resolve(-1)
        : Product.countDocuments(query),
    ]);

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

export async function getProductsByCategory(categoryName: string) {
  try {
    await connectDB();
    const products = await Product.find({
      category: { $exists: true, $nin: [null, ""] },
      $or: [{ category: categoryName }, { subCategory: categoryName }],
    })
      .sort({ createdAt: -1 })
      .select("name price images category subCategory stock shopifyVariantId")
      .lean();
    return serialize(products);
  } catch (error) {
    console.error("Failed to fetch products by category:", error);
    return [];
  }
}

/** Deduped per request (metadata + page share one Mongo read). */
export const getPublicProduct = cache(async (id: string) => {
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
  const { pricedOnlyClause } = await import("@/lib/pricedOnly");
  const pricedClause = pricedOnlyClause();
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
      .select("images")
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
export async function getHomeRangeBands(limitPerBand = 4) {
  try {
    await connectDB();
    const { Department } = await import("@/models/Department");
    const { pricedOnlyClause } = await import("@/lib/pricedOnly");
    const { pricePerSqmFrom, isAreaSoldCategory } = await import(
      "@/lib/tileCalculator"
    );
    const { resolveStorefrontUnitPrice } = await import("@/lib/naturaPrice");
    const priced = pricedOnlyClause() || {};
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
    ]);

    const departments = (
      await Department.find({ isActive: true }).sort({ order: 1, name: 1 }).lean()
    ).filter((d: any) => !HOMEPAGE_EXCLUDED_DEPARTMENTS.has(String(d.slug)));

    const bands = await Promise.all(
      departments.map(async (dept: any) => {
        const match: Record<string, unknown> = {
          department: dept.slug,
          category: { $exists: true, $nin: [null, ""] },
          ...priced,
          ...(excludedIds.length ? { brand: { $nin: excludedIds } } : {}),
        };

        const [products, productCount] = await Promise.all([
          Product.find(match)
            .select("name price images category subCategory specs stock brand")
            .populate("brand", "name uiName slug")
            .sort({ price: 1 })
            .limit(limitPerBand * 4)
            .lean(),
          Product.countDocuments(match),
        ]);
        if (!products.length) return null;

        const withImages = products.filter(
          (p: any) => (p.images || []).length > 0,
        );
        const chosen = (withImages.length ? withImages : products).slice(
          0,
          limitPerBand,
        );

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
            const compareAt = Number(p?.specs?.compareAtPrice);
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

            if (raiseWasKeepPrice) {
              // p.price = original (sell); compareAt = raised was
              const wasR = rate({ ...p, price: compareAt });
              price = r.price;
              wasPrice = wasR.price;
              discountPercent = Math.round(salePct);
            } else if (raiseThenPercent) {
              wasPrice = r.price;
              price =
                Math.round(r.price * (1 - salePct / 100) * 100) / 100;
              discountPercent = Math.round(salePct);
            } else if (hasCompareSale) {
              const wasR = rate({ ...p, price: compareAt });
              price = r.price;
              wasPrice = wasR.price;
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
    const { pricedOnlyClause } = await import("@/lib/pricedOnly");
    const priced = pricedOnlyClause() || {};
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
