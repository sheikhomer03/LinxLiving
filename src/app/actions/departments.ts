"use server";

import connectDB from "@/lib/mongodb";
import { Department } from "@/models/Department";
import { Menu } from "@/models/Menu";
import { Brand } from "@/models/Brand";
import { Product } from "@/models/Product";
import { revalidatePath, updateTag, unstable_cache } from "next/cache";
import { LINX_DEPARTMENTS, slugifyTaxonomy } from "@/lib/catalogueTaxonomy";
import { isAccessoryCategory } from "@/lib/accessories";
import { uploadImageToCloudinary } from "@/app/actions/storage";

function serialize(doc: any) {
  return JSON.parse(JSON.stringify(doc));
}

export async function getDepartments(includeInactive = false) {
  try {
    await connectDB();
    const q = includeInactive ? {} : { isActive: true };
    const departments = await Department.find(q).sort({ order: 1, name: 1 }).lean();
    return { success: true, departments: serialize(departments) };
  } catch (error) {
    console.error("getDepartments:", error);
    return { success: false, departments: [] };
  }
}

/**
 * Department → categories → subcategories tree for mega menu / catalogue.
 *
 * The result is identical on every page of the site and changes only when a
 * department, menu or product changes — but it ran on every request, costing
 * ~600ms of three full-collection aggregations each time. Cached under the
 * "navigation" tag; admin mutations already call revalidatePath, and
 * revalidateNavigation() below clears it explicitly. Output is unchanged.
 */
export async function getDepartmentTrees() {
  return cachedDepartmentTrees();
}

const cachedDepartmentTrees = unstable_cache(
  async () => buildDepartmentTrees(),
  ["department-trees-v25"],
  { revalidate: 300, tags: ["navigation"] },
);

function mapBrandForNav(b: any) {
  const uiName = String(b?.uiName || "").trim();
  const name = String(b?.name || "").trim();
  return {
    _id: String(b._id),
    name: uiName || name,
    actualName: name,
    uiName,
    slug: b.slug,
    order: b.order,
  };
}

async function buildDepartmentTrees() {
  try {
    await connectDB();
    const { getExcludedStorefrontBrandIds } = await import(
      "@/lib/excludedStorefrontBrands"
    );
    const excludedBrandIds = await getExcludedStorefrontBrandIds();
    const excludedBrandIdSet = new Set(
      excludedBrandIds.map((id) => String(id)),
    );

    const [departments, menusRaw] = await Promise.all([
      Department.find({ isActive: true }).sort({ order: 1, name: 1 }).lean(),
      Menu.find({
        isActive: { $ne: false },
        department: { $ne: null },
      })
        .sort({ order: 1, name: 1 })
        .lean(),
    ]);

    // Drop menus owned by Hidden / excluded brands so their categories never
    // appear in the navbar or catalogue department trees.
    const menus = (menusRaw || []).filter((m: any) => {
      if (!m.brand) return true;
      return !excludedBrandIdSet.has(String(m.brand));
    });

    const byDept = new Map<string, any[]>();
    for (const m of menus) {
      const key = String(m.department);
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(m);
    }

    // Display-only tidy-up. Nothing below writes to the database — products,
    // menus and departments are read exactly as they are.
    //
    // 1. Which departments actually contain products? Departments with none
    //    are hidden so customers never land on an empty page.
    // Counts respect the storefront price rule and exclude Hidden brands.
    const { pricedOnlyClause } = await import("@/lib/pricedOnly");
    const pricedMatch = pricedOnlyClause() || {};
    const storefrontProductMatch: Record<string, unknown> = {
      department: { $nin: ["", null] },
      ...pricedMatch,
      ...(excludedBrandIds.length
        ? { brand: { $nin: excludedBrandIds } }
        : {}),
    };
    const deptCounts = await Product.aggregate<{ _id: string; count: number }>([
      { $match: storefrontProductMatch },
      { $group: { _id: "$department", count: { $sum: 1 } } },
    ]);
    const stocked = new Map(
      deptCounts.map((r) => [String(r._id), r.count]),
    );

    // 1b. Same rule one level down: a category or subcategory with no products
    //     behind it renders an empty "No products found" page, so it must not
    //     appear in the menu either. Counted per department because the same
    //     category slug can exist under more than one.
    const catCounts = await Product.aggregate<{
      _id: { department: string; category: string };
      count: number;
    }>([
      { $match: storefrontProductMatch },
      {
        $group: {
          _id: { department: "$department", category: "$category" },
          count: { $sum: 1 },
        },
      },
    ]);
    const stockedCategories = new Set(
      catCounts
        .filter((r) => r.count > 0 && r._id.category)
        .map((r) =>
          `${r._id.department}::${String(r._id.category).trim().toLowerCase()}`,
        ),
    );

    const subCounts = await Product.aggregate<{
      _id: { department: string; subCategory: string };
      count: number;
    }>([
      { $match: storefrontProductMatch },
      {
        $group: {
          _id: { department: "$department", subCategory: "$subCategory" },
          count: { $sum: 1 },
        },
      },
    ]);
    const stockedSubCategories = new Set(
      subCounts
        .filter((r) => r.count > 0 && r._id.subCategory)
        .map((r) =>
          `${r._id.department}::${String(r._id.subCategory).trim().toLowerCase()}`,
        ),
    );

    // 2. Brand names that have leaked into the category tree are not real
    //    categories — drop them from the menu display.
    const brandNames = new Set(
      (await Brand.find({}).select("name slug").lean()).flatMap((b: any) =>
        [b.name, b.slug].filter(Boolean).map((v: string) =>
          String(v).trim().toLowerCase(),
        ),
      ),
    );
    const isBrandLabel = (m: any) =>
      brandNames.has(String(m?.name || "").trim().toLowerCase()) ||
      brandNames.has(String(m?.slug || "").trim().toLowerCase());

    // Brand+category pairs with at least one priced product — used so the
    // Accessories mega tab does not list unpriced ranges (e.g. Noken).
    const {
      getPricedBrandCategoryKeys,
      brandCategoryKey,
    } = await import("@/lib/pricedBrandCategories");
    const pricedKeys = await getPricedBrandCategoryKeys();

    const trees = departments
      .map((d: any) => {
        const all = byDept.get(String(d._id)) || [];
        const parents = all.filter((m) => !m.parent && !isBrandLabel(m));
        const children = all.filter((m) => m.parent && !isBrandLabel(m));

        // 3. The same category can exist once per brand (e.g. two copies of
        //    "pitched-roof-windows"). Merge them into one entry by slug so the
        //    menu shows it a single time, keeping every brand's subcategories.
        const menuSubSlugs = (m: any): string[] => {
          const fromArr = Array.isArray(m?.subBrands)
            ? m.subBrands.map((s: any) => String(s || "").trim().toLowerCase())
            : [];
          const single = String(m?.subBrand || "")
            .trim()
            .toLowerCase();
          return [...new Set([...fromArr, ...(single ? [single] : [])])].filter(
            Boolean,
          );
        };

        const bySlug = new Map<string, any>();
        for (const p of parents) {
          const key = String(p.slug || p._id);
          const kids = children.filter(
            (c) => String(c.parent) === String(p._id),
          );
          const brandId = p.brand ? String(p.brand) : "";
          const subs = menuSubSlugs(p);
          const existing = bySlug.get(key);
          if (existing) {
            const seen = new Set(
              existing.children.map((c: any) => String(c.slug || c._id)),
            );
            for (const k of kids) {
              const kk = String(k.slug || k._id);
              if (!seen.has(kk)) {
                seen.add(kk);
                existing.children.push(k);
              }
            }
            // Keep every brand that owns this category slug (e.g. FAKRO +
            // Sterlingbuild both have "Pitched Roof Windows").
            if (brandId && !existing.brandIds.includes(brandId)) {
              existing.brandIds.push(brandId);
            }
            // Union manufacturer sub-brands across shared category copies.
            const subSet = new Set<string>(
              Array.isArray(existing.subBrands) ? existing.subBrands : [],
            );
            for (const s of subs) subSet.add(s);
            existing.subBrands = [...subSet];
          } else {
            bySlug.set(key, {
              ...p,
              children: [...kids],
              brandIds: brandId ? [brandId] : [],
              subBrands: subs,
            });
          }
        }

        const deptSlug = String(d.slug || "").trim().toLowerCase();
        const hasProducts = (slug: any, index: Set<string>) =>
          index.has(`${deptSlug}::${String(slug || "").trim().toLowerCase()}`);

        // Drop empty categories, and empty subcategories within the ones that
        // survive. A category is kept if it has products directly against it
        // or via any of its subcategories.
        // Keep accessory categories in the tree (towel warmers, mirrors, …)
        // so the Accessories mega tab can list them by brand — but only for
        // brands that have priced products in that range (pricedBrandIds).
        const categories = [...bySlug.values()]
          .map((c: any) => {
            const isAccessory = isAccessoryCategory(c.name, c.slug);
            const brandIds: string[] = Array.isArray(c.brandIds)
              ? c.brandIds.map(String)
              : c.brand
                ? [String(c.brand)]
                : [];
            const pricedBrandIds = isAccessory
              ? brandIds.filter((id) =>
                  pricedKeys.has(brandCategoryKey(id, c.slug)),
                )
              : brandIds;
            return {
              ...c,
              isAccessory,
              pricedBrandIds,
              children: (c.children || []).filter((k: any) =>
                hasProducts(k.slug, stockedSubCategories),
              ),
            };
          })
          .filter((c: any) => {
            if (c.isAccessory) {
              // Accessories tab only — hide if no brand has priced stock.
              return (c.pricedBrandIds || []).length > 0;
            }
            return (
              hasProducts(c.slug, stockedCategories) || c.children.length > 0
            );
          });

        // Brands for "Our Brands" — main product categories only (not accessories).
        const brandIdSet = new Set<string>();
        for (const c of categories) {
          if (c.isAccessory) continue;
          for (const id of c.brandIds || []) {
            if (id) brandIdSet.add(String(id));
          }
          if (c.brand) brandIdSet.add(String(c.brand));
        }

        return {
          ...d,
          productCount: stocked.get(String(d.slug)) || 0,
          categories,
          brandIds: [...brandIdSet],
        };
      })
      // Hide departments with no products behind them.
      .filter((d: any) => d.productCount > 0 && d.categories.length > 0);

    // Resolve brandIds → { _id, name, slug } for the navbar "Our Brands" column.
    const { filterHiddenBrands } = await import("@/lib/hiddenBrands");
    const mongoose = await import("mongoose");
    const objectIds = [...new Set(trees.flatMap((d: any) => d.brandIds || []))]
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const brandDocs = objectIds.length
      ? await Brand.find({ _id: { $in: objectIds }, isActive: true })
          .select("_id name uiName slug order")
          .sort({ order: 1, name: 1 })
          .lean()
      : [];
    const brandById = new Map(
      filterHiddenBrands(brandDocs.map(mapBrandForNav)).map((b) => [b._id, b]),
    );

    let withBrands = trees.map((d: any) => ({
      ...d,
      brands: (d.brandIds || [])
        .map((id: string) => brandById.get(String(id)))
        .filter(Boolean)
        .sort(
          (a: any, b: any) =>
            (a.order ?? 0) - (b.order ?? 0) ||
            String(a.name).localeCompare(String(b.name)),
        ),
    }));

    // ── Accessories as its own department ─────────────────────────────
    // Pull accessory ranges out of other departments (and any brand top-level
    // accessory menus) into a dedicated "Accessories" nav department so it
    // sits alongside Bathrooms / Tiles / Heating instead of a one-off tab.
    {
      const accBySlug = new Map<string, any>();
      const accBrandIds = new Set<string>();

      const mergeAcc = (c: any) => {
        if (!c?.slug) return;
        if (!c.isAccessory && !isAccessoryCategory(c.name, c.slug)) return;
        const priced = Array.isArray(c.pricedBrandIds)
          ? c.pricedBrandIds.map(String)
          : Array.isArray(c.brandIds)
            ? c.brandIds.map(String)
            : c.brand
              ? [String(c.brand)]
              : [];
        if (priced.length === 0) return;

        const key = String(c.slug);
        const existing = accBySlug.get(key);
        if (existing) {
          for (const id of priced) {
            if (!existing.brandIds.includes(id)) existing.brandIds.push(id);
            if (!existing.pricedBrandIds.includes(id)) {
              existing.pricedBrandIds.push(id);
            }
          }
          const seen = new Set(
            (existing.children || []).map((k: any) => String(k.slug || k._id)),
          );
          for (const k of c.children || []) {
            const kk = String(k.slug || k._id);
            if (!seen.has(kk)) {
              seen.add(kk);
              existing.children.push(k);
            }
          }
        } else {
          accBySlug.set(key, {
            ...c,
            isAccessory: true,
            brandIds: [...priced],
            pricedBrandIds: [...priced],
            children: [...(c.children || [])],
          });
        }
        for (const id of priced) accBrandIds.add(id);
      };

      for (const d of withBrands) {
        for (const c of d.categories || []) mergeAcc(c);
      }

      // Brand top-level accessory menus (e.g. Fakro flashings) that may not
      // already appear under another department tree.
      const brandAccMenus = await Menu.find({
        isActive: { $ne: false },
        parent: null,
        brand: {
          $exists: true,
          $nin: [null, ...(excludedBrandIds as any[])],
        },
      })
        .sort({ order: 1, name: 1 })
        .lean();

      const accParentCandidates = (brandAccMenus || []).filter((m: any) => {
        if (!isAccessoryCategory(m.name, m.slug)) return false;
        const brandId = m.brand ? String(m.brand) : "";
        if (!brandId || excludedBrandIdSet.has(brandId)) return false;
        return pricedKeys.has(brandCategoryKey(brandId, m.slug));
      });
      const accParentIds = accParentCandidates.map((m: any) => m._id);
      const accChildren = accParentIds.length
        ? await Menu.find({
            parent: { $in: accParentIds },
            isActive: { $ne: false },
          })
            .sort({ order: 1, name: 1 })
            .lean()
        : [];
      const kidsByParent = new Map<string, any[]>();
      for (const k of accChildren) {
        const pk = String(k.parent);
        if (!kidsByParent.has(pk)) kidsByParent.set(pk, []);
        kidsByParent.get(pk)!.push(k);
      }

      for (const m of accParentCandidates) {
        const brandId = String(m.brand);
        mergeAcc({
          ...m,
          isAccessory: true,
          brandIds: [brandId],
          pricedBrandIds: [brandId],
          children: kidsByParent.get(String(m._id)) || [],
        });
      }

      if (accBySlug.size > 0) {
        let accDeptDoc: any = await Department.findOne({
          slug: "accessories",
        }).lean();
        if (!accDeptDoc) {
          const created = await Department.create({
            name: "Accessories",
            slug: "accessories",
            order: 18.5,
            isActive: true,
            description:
              "Fixings, flashings, towel warmers, mirrors and other accessory ranges.",
          });
          accDeptDoc = created.toObject?.() ?? created;
        } else if (accDeptDoc.isActive === false) {
          accDeptDoc =
            (await Department.findOneAndUpdate(
              { slug: "accessories" },
              { $set: { isActive: true } },
              { returnDocument: "after" },
            ).lean()) || accDeptDoc;
        }

        const missingBrandIds = [...accBrandIds].filter(
          (id) => !brandById.has(id),
        );
        if (missingBrandIds.length) {
          const extra = await Brand.find({
            _id: {
              $in: missingBrandIds
                .map((id) => {
                  try {
                    return new mongoose.Types.ObjectId(id);
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean),
            },
            isActive: true,
          })
            .select("_id name uiName slug order")
            .lean();
          for (const b of filterHiddenBrands(extra.map(mapBrandForNav))) {
            brandById.set(b._id, b);
          }
        }

        const accSlugs = [...accBySlug.keys()];
        const accProductCount = await Product.countDocuments({
          ...pricedMatch,
          ...(excludedBrandIds.length
            ? { brand: { $nin: excludedBrandIds } }
            : {}),
          category: { $in: accSlugs },
        });

        const accCategories = [...accBySlug.values()].sort((a, b) =>
          String(a.name).localeCompare(String(b.name)),
        );

        // Drop accessory rows from other departments so they only live here.
        withBrands = withBrands
          .map((d: any) => ({
            ...d,
            categories: (d.categories || []).filter(
              (c: any) =>
                !c.isAccessory && !isAccessoryCategory(c.name, c.slug),
            ),
          }))
          .filter(
            (d: any) =>
              (d.categories || []).length > 0 && (d.productCount || 0) > 0,
          );

        withBrands.push({
          ...accDeptDoc,
          _id: String(accDeptDoc._id),
          name: "Accessories",
          slug: "accessories",
          order: accDeptDoc.order ?? 18.5,
          productCount: accProductCount || accCategories.length,
          categories: accCategories,
          brandIds: [...accBrandIds],
          brands: [...accBrandIds]
            .map((id) => brandById.get(id))
            .filter(Boolean)
            .sort(
              (a: any, b: any) =>
                (a.order ?? 0) - (b.order ?? 0) ||
                String(a.name).localeCompare(String(b.name)),
            ),
        });

        withBrands.sort(
          (a: any, b: any) =>
            (a.order ?? 0) - (b.order ?? 0) ||
            String(a.name).localeCompare(String(b.name)),
        );
      }
    }

    // Size buckets (Small / Medium / Large / XL) from real product specs.size
    // values in each department's categories — Accessories included.
    const { buildSizeBucketFacets } = await import("@/lib/sizeBuckets");
    const deptCatSlugs = new Map<string, string[]>();
    const allCatSlugs = new Set<string>();
    for (const d of withBrands) {
      const isAccessoriesDept = String(d.slug) === "accessories";
      const slugs = (d.categories || [])
        .filter(
          (c: any) =>
            isAccessoriesDept ||
            (!c.isAccessory && !isAccessoryCategory(c.name, c.slug)),
        )
        .map((c: any) => String(c.slug || ""))
        .filter(Boolean);
      deptCatSlugs.set(String(d.slug), slugs);
      for (const s of slugs) allCatSlugs.add(s);
    }

    // Prefer specs.size, fall back to specs.Size (Porcelanosa / bathroom imports).
    const sizeRows = allCatSlugs.size
      ? await Product.aggregate<{
          _id: { department: string | null; category: string; size: string };
          count: number;
        }>([
          {
            $match: {
              ...pricedMatch,
              ...(excludedBrandIds.length
                ? { brand: { $nin: excludedBrandIds } }
                : {}),
              $or: [
                {
                  department: {
                    $in: withBrands.map((d: any) => String(d.slug)),
                  },
                },
                { category: { $in: [...allCatSlugs] } },
              ],
            },
          },
          {
            $addFields: {
              _sizeRaw: {
                $let: {
                  vars: {
                    a: { $ifNull: ["$specs.size", ""] },
                    b: { $ifNull: ["$specs.Size", ""] },
                  },
                  in: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$$a", ""] },
                          { $ne: ["$$a", null] },
                        ],
                      },
                      "$$a",
                      "$$b",
                    ],
                  },
                },
              },
            },
          },
          {
            $match: {
              _sizeRaw: {
                $exists: true,
                $nin: [null, "", "N/A", "n/a", "NA"],
                $type: "string",
              },
            },
          },
          {
            $group: {
              _id: {
                department: "$department",
                category: "$category",
                size: "$_sizeRaw",
              },
              count: { $sum: 1 },
            },
          },
        ])
      : [];

    type FacetAcc = { count: number; brandIds: Set<string> };
    const sizesByDept = new Map<string, Map<string, number>>();
    const colorsByDept = new Map<string, Map<string, FacetAcc>>();
    const stylesByDept = new Map<string, Map<string, FacetAcc>>();
    const rangesByDept = new Map<string, Map<string, FacetAcc>>();
    for (const d of withBrands) {
      const slug = String(d.slug);
      sizesByDept.set(slug, new Map());
      colorsByDept.set(slug, new Map());
      stylesByDept.set(slug, new Map());
      rangesByDept.set(slug, new Map());
    }
    for (const row of sizeRows) {
      const size = String(row._id?.size || "").trim();
      if (!size) continue;
      const cat = String(row._id?.category || "");
      const deptField = String(row._id?.department || "");
      const n = row.count || 0;

      // Attribute to every department that owns this category slug, plus
      // direct department tagging on the product.
      for (const [deptSlug, slugs] of deptCatSlugs) {
        const viaDept = deptField === deptSlug;
        const viaCat = cat && slugs.includes(cat);
        if (!viaDept && !viaCat) continue;
        const map = sizesByDept.get(deptSlug)!;
        map.set(size, (map.get(size) || 0) + n);
      }
    }

    // Colors / Style facets from real product specs (skip Accessories dept).
    const colorStyleMatch = {
      ...pricedMatch,
      ...(excludedBrandIds.length
        ? { brand: { $nin: excludedBrandIds } }
        : {}),
      $or: [
        {
          department: {
            $in: withBrands
              .filter((d: any) => String(d.slug) !== "accessories")
              .map((d: any) => String(d.slug)),
          },
        },
        {
          category: {
            $in: [...allCatSlugs].filter((s) => {
              // exclude accessory-only slugs owned solely by accessories dept
              const acc = deptCatSlugs.get("accessories");
              if (!acc?.includes(s)) return true;
              // keep if also in another dept
              for (const [slug, list] of deptCatSlugs) {
                if (slug === "accessories") continue;
                if (list.includes(s)) return true;
              }
              return false;
            }),
          },
        },
      ],
    };

    const colorStyleRows = await Product.aggregate<{
      _id: {
        department: string | null;
        category: string;
        color: string;
        style: string;
        range: string;
        brand: unknown;
      };
      count: number;
    }>([
      { $match: colorStyleMatch },
      {
        $addFields: {
          _colorRaw: {
            $trim: {
              input: {
                $toString: {
                  $ifNull: [
                    "$specs.Colour",
                    {
                      $ifNull: [
                        "$specs.Color",
                        {
                          $ifNull: [
                            "$specs.colour",
                            {
                              $ifNull: [
                                "$specs.COLOUR",
                                { $ifNull: ["$specs.color", ""] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
          _styleRaw: {
            $trim: {
              input: {
                $toString: {
                  $ifNull: [
                    "$specs.Style",
                    {
                      $ifNull: [
                        "$specs.style",
                        {
                          $ifNull: [
                            "$specs.finish",
                            {
                              $ifNull: [
                                "$specs.Finish",
                                {
                                  $ifNull: [
                                    "$specs.FINISH",
                                    {
                                      $ifNull: [
                                        "$specs.Floor Style",
                                        { $ifNull: ["$finish", ""] },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          // Collection / range name. Flooring brands carry this where they
          // have no colour or finish attributes, so it is the only real
          // grouping those departments can offer.
          _rangeRaw: {
            $trim: {
              input: {
                $toString: {
                  $ifNull: [
                    "$specs.range",
                    {
                      $ifNull: [
                        "$specs.Range",
                        {
                          $ifNull: [
                            "$specs.RANGE",
                            { $ifNull: ["$specs.collection", ""] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: {
            department: "$department",
            category: "$category",
            color: "$_colorRaw",
            style: "$_styleRaw",
            range: "$_rangeRaw",
            brand: "$brand",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const attributeFacet = (
      target: Map<string, Map<string, FacetAcc>>,
      deptField: string,
      cat: string,
      value: string,
      brandId: string,
      n: number,
    ) => {
      const v = String(value || "").trim();
      if (!v || v === "null" || v === "undefined") return;
      for (const [deptSlug, slugs] of deptCatSlugs) {
        if (deptSlug === "accessories") continue;
        const viaDept = deptField === deptSlug;
        const viaCat = cat && slugs.includes(cat);
        if (!viaDept && !viaCat) continue;
        const map = target.get(deptSlug);
        if (!map) continue;
        let entry = map.get(v);
        if (!entry) {
          entry = { count: 0, brandIds: new Set() };
          map.set(v, entry);
        }
        entry.count += n;
        if (brandId) entry.brandIds.add(brandId);
      }
    };

    const neededBrandIds = new Set<string>();
    for (const row of colorStyleRows) {
      const cat = String(row._id?.category || "");
      const deptField = String(row._id?.department || "");
      const brandId =
        row._id?.brand != null ? String(row._id.brand) : "";
      const n = row.count || 0;
      if (brandId) neededBrandIds.add(brandId);
      attributeFacet(
        colorsByDept,
        deptField,
        cat,
        String(row._id?.color || ""),
        brandId,
        n,
      );
      attributeFacet(
        stylesByDept,
        deptField,
        cat,
        String(row._id?.style || ""),
        brandId,
        n,
      );
      attributeFacet(
        rangesByDept,
        deptField,
        cat,
        String(row._id?.range || ""),
        brandId,
        n,
      );
    }

    // Resolve any brand ids seen on colour/style products that aren't in
    // the department brand map yet (needed for navbar auto-brand filter).
    const missingForFacets = [...neededBrandIds].filter(
      (id) => !brandById.has(id) && !excludedBrandIdSet.has(id),
    );
    if (missingForFacets.length) {
      const extraFacetBrands = await Brand.find({
        _id: {
          $in: missingForFacets
            .map((id) => {
              try {
                return new mongoose.Types.ObjectId(id);
              } catch {
                return null;
              }
            })
            .filter(Boolean),
        },
        isActive: true,
      })
        .select("_id name uiName slug order")
        .lean();
      for (const b of filterHiddenBrands(extraFacetBrands.map(mapBrandForNav))) {
        brandById.set(b._id, b);
      }
    }

    const toFacetList = (map: Map<string, FacetAcc>, limit = 14) =>
      [...map.entries()]
        .filter(([, acc]) => acc.count > 0)
        .sort(
          (a, b) =>
            b[1].count - a[1].count || a[0].localeCompare(b[0]),
        )
        .slice(0, limit)
        .map(([value, acc]) => {
          const brandSlugs = [...acc.brandIds]
            .map((id) => brandById.get(id)?.slug)
            .filter(Boolean) as string[];
          return {
            value,
            label: value,
            count: acc.count,
            brandSlugs: [...new Set(brandSlugs)],
          };
        });

    const withSizes = withBrands.map((d: any) => {
      const slug = String(d.slug);
      const map = sizesByDept.get(slug) || new Map();
      const rows = [...map.entries()].map(([size, count]) => ({
        size,
        count,
      }));
      const isAcc = slug === "accessories";
      return {
        ...d,
        sizeBuckets: buildSizeBucketFacets(rows),
        colors: isAcc ? [] : toFacetList(colorsByDept.get(slug) || new Map()),
        styles: isAcc ? [] : toFacetList(stylesByDept.get(slug) || new Map()),
        ranges: isAcc ? [] : toFacetList(rangesByDept.get(slug) || new Map()),
      };
    });

    return { success: true, departments: serialize(withSizes) };
  } catch (error) {
    console.error("getDepartmentTrees:", error);
    return { success: false, departments: [] };
  }
}

export async function createDepartment(formData: FormData) {
  try {
    await connectDB();
    const name = String(formData.get("name") || "").trim();
    let slug = String(formData.get("slug") || "").trim().toLowerCase();
    const description = String(formData.get("description") || "").trim();
    const order = Number(formData.get("order") || 0) || 0;
    const isActive = formData.get("isActive") !== "false";
    let image = String(formData.get("imageUrl") || "").trim();
    const imageFile = formData.get("image");

    if (!name) return { success: false, error: "Name is required" };
    if (!slug) slug = slugifyTaxonomy(name);

    if (
      imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0
    ) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/departments",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    }

    const exists = await Department.findOne({ slug });
    if (exists) return { success: false, error: "Slug already exists" };

    const department = await Department.create({
      name,
      slug,
      description,
      order,
      isActive,
      image,
    });

    revalidatePath("/");
    updateTag("navigation");
    revalidatePath("/admin/departments");
    revalidatePath("/category");
    return { success: true, department: serialize(department) };
  } catch (error: any) {
    console.error("createDepartment:", error);
    return { success: false, error: error.message || "Failed to create department" };
  }
}

export async function updateDepartment(id: string, formData: FormData) {
  try {
    await connectDB();
    const name = String(formData.get("name") || "").trim();
    let slug = String(formData.get("slug") || "").trim().toLowerCase();
    const description = String(formData.get("description") || "").trim();
    const order = Number(formData.get("order") || 0) || 0;
    const isActive = formData.get("isActive") !== "false";
    let image = String(formData.get("imageUrl") || "").trim();
    const imageFile = formData.get("image");

    if (!name) return { success: false, error: "Name is required" };
    if (!slug) slug = slugifyTaxonomy(name);

    if (
      imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0
    ) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/departments",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    }

    const clash = await Department.findOne({ slug, _id: { $ne: id } });
    if (clash) return { success: false, error: "Slug already exists" };

    const department = await Department.findByIdAndUpdate(
      id,
      { name, slug, description, order, isActive, image },
      { new: true },
    );
    if (!department) return { success: false, error: "Department not found" };

    revalidatePath("/");
    updateTag("navigation");
    revalidatePath("/admin/departments");
    revalidatePath("/category");
    return { success: true, department: serialize(department) };
  } catch (error: any) {
    console.error("updateDepartment:", error);
    return { success: false, error: error.message || "Failed to update department" };
  }
}

export async function deleteDepartment(id: string) {
  try {
    await connectDB();
    const linkedMenus = await Menu.countDocuments({ department: id });
    if (linkedMenus > 0) {
      return {
        success: false,
        error: `Cannot delete: ${linkedMenus} categor(ies) still linked`,
      };
    }
    await Department.findByIdAndDelete(id);
    revalidatePath("/admin/departments");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to delete" };
  }
}

/** Seed the 20 LINX departments (idempotent). */
export async function seedLinxDepartments() {
  try {
    await connectDB();
    let created = 0;
    let updated = 0;
    for (let i = 0; i < LINX_DEPARTMENTS.length; i++) {
      const d = LINX_DEPARTMENTS[i];
      const res = await Department.updateOne(
        { slug: d.slug },
        {
          $set: {
            name: d.name,
            slug: d.slug,
            order: i,
            isActive: true,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
            image: "",
            description: "",
            showInConfigurator: false,
          },
        },
        { upsert: true },
      );
      if (res.upsertedCount) created += 1;
      else if (res.modifiedCount) updated += 1;
    }
    revalidatePath("/admin/departments");
    revalidatePath("/admin/configurator");
    revalidatePath("/configurator");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true, created, updated, total: LINX_DEPARTMENTS.length };
  } catch (error: any) {
    console.error("seedLinxDepartments:", error);
    return { success: false, error: error.message || "Seed failed" };
  }
}

/**
 * Backfill product.department from brand/category heuristics for products missing it.
 * Also links brand category menus to inferred departments when unset.
 */
export async function backfillProductDepartments(limit = 5000) {
  try {
    await connectDB();
    const { inferDepartmentSlug } = await import("@/lib/catalogueTaxonomy");
    const brands = await Brand.find({}).select("_id slug name").lean();
    const brandById = new Map(brands.map((b: any) => [String(b._id), b]));
    const departments = await Department.find({}).select("_id slug").lean();
    const deptBySlug = new Map(departments.map((d: any) => [d.slug, d._id]));

    const products = await Product.find({
      $or: [{ department: "" }, { department: null }, { department: { $exists: false } }],
    })
      .select("_id name category subCategory brand")
      .limit(limit)
      .lean();

    let updated = 0;
    for (const p of products) {
      const brand = p.brand ? brandById.get(String(p.brand)) : null;
      const slug = inferDepartmentSlug({
        brandSlug: brand?.slug,
        categorySlug: p.category,
        categoryName: p.category,
      });
      await Product.updateOne({ _id: p._id }, { $set: { department: slug } });
      updated += 1;
    }

    // Link top-level brand menus to departments when missing
    const topMenus = await Menu.find({
      parent: null,
      $or: [{ department: null }, { department: { $exists: false } }],
    })
      .select("_id name slug brand")
      .lean();
    let menusLinked = 0;
    for (const m of topMenus) {
      const brand = m.brand ? brandById.get(String(m.brand)) : null;
      const slug = inferDepartmentSlug({
        brandSlug: brand?.slug,
        categorySlug: m.slug,
        categoryName: m.name,
      });
      const deptId = deptBySlug.get(slug);
      if (!deptId) continue;
      await Menu.updateOne(
        { _id: m._id },
        { $set: { department: deptId, level: "category" } },
      );
      menusLinked += 1;
    }

    // Mark children as subcategory
    await Menu.updateMany(
      { parent: { $ne: null }, level: { $ne: "subcategory" } },
      { $set: { level: "subcategory" } },
    );

    revalidatePath("/category");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true, productsUpdated: updated, menusLinked };
  } catch (error: any) {
    console.error("backfillProductDepartments:", error);
    return { success: false, error: error.message || "Backfill failed" };
  }
}
