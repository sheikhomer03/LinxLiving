"use server";

import connectDB from "@/lib/mongodb";
import { Department } from "@/models/Department";
import { Menu } from "@/models/Menu";
import { Brand } from "@/models/Brand";
import { Product } from "@/models/Product";
import { revalidatePath } from "next/cache";
import { LINX_DEPARTMENTS, slugifyTaxonomy } from "@/lib/catalogueTaxonomy";
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

/** Department → categories → subcategories tree for mega menu / catalogue */
export async function getDepartmentTrees() {
  try {
    await connectDB();
    const [departments, menus] = await Promise.all([
      Department.find({ isActive: true }).sort({ order: 1, name: 1 }).lean(),
      Menu.find({
        isActive: { $ne: false },
        department: { $ne: null },
      })
        .sort({ order: 1, name: 1 })
        .lean(),
    ]);

    const byDept = new Map<string, any[]>();
    for (const m of menus) {
      const key = String(m.department);
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(m);
    }

    const trees = departments.map((d: any) => {
      const all = byDept.get(String(d._id)) || [];
      const parents = all.filter((m) => !m.parent);
      const children = all.filter((m) => m.parent);
      return {
        ...d,
        categories: parents.map((p) => ({
          ...p,
          children: children.filter((c) => String(c.parent) === String(p._id)),
        })),
      };
    });

    return { success: true, departments: serialize(trees) };
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
    return { success: true, productsUpdated: updated, menusLinked };
  } catch (error: any) {
    console.error("backfillProductDepartments:", error);
    return { success: false, error: error.message || "Backfill failed" };
  }
}
