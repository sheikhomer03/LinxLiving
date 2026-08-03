"use server";

import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { Department } from "@/models/Department";
import { Menu } from "@/models/Menu";
import { Product } from "@/models/Product";
import { Brand } from "@/models/Brand";
import { revalidatePath } from "next/cache";

/** Optional admin helper — never auto-run on the storefront. */
const DEFAULT_HUB_DEPARTMENT_SLUGS = [
  "windows-and-doors",
  "rooflights-and-glass",
] as const;

function serialize(doc: any) {
  return JSON.parse(JSON.stringify(doc));
}

function revalidateConfigurator() {
  revalidatePath("/configurator");
  revalidatePath("/admin/configurator");
  revalidatePath("/admin/departments");
  revalidatePath("/");
}

async function inactiveBrandIds() {
  const inactive = await Brand.find({ isActive: false }).select("_id").lean();
  return inactive.map((b: any) => b._id);
}

/** Live products explicitly tagged with this department (strict). */
async function departmentProductCount(
  dept: { _id: unknown; slug: string },
  inactiveIds: unknown[],
) {
  const and: any[] = [
    { category: { $exists: true, $nin: [null, ""] } },
    { department: dept.slug },
  ];
  if (inactiveIds.length) {
    and.push({ brand: { $nin: inactiveIds } });
  }
  return Product.countDocuments({ $and: and });
}

/**
 * Enable suggested departments for the Configurator hub (admin only).
 */
export async function ensureConfiguratorDepartmentsEnabled() {
  try {
    await connectDB();
    const res = await Department.collection.updateMany(
      { slug: { $in: [...DEFAULT_HUB_DEPARTMENT_SLUGS] } },
      { $set: { showInConfigurator: true, updatedAt: new Date() } },
    );
    revalidateConfigurator();
    return {
      success: true,
      matched: res.matchedCount,
      modified: res.modifiedCount,
    };
  } catch (error: any) {
    console.error("ensureConfiguratorDepartmentsEnabled:", error);
    return { success: false, error: error.message || "Failed" };
  }
}

/**
 * Storefront hub: only departments toggled on AND with real catalogue products.
 */
export async function getConfiguratorHubDepartments() {
  try {
    await connectDB();

    const departments = await Department.find({
      isActive: true,
      showInConfigurator: true,
    })
      .sort({ order: 1, name: 1 })
      .lean();

    if (!departments.length) {
      return { success: true, departments: [] };
    }

    const inactiveIds = await inactiveBrandIds();
    const withCounts = await Promise.all(
      departments.map(async (d: any) => {
        const productCount = await departmentProductCount(d, inactiveIds);
        return { ...d, productCount };
      }),
    );

    const live = withCounts.filter((d) => d.productCount > 0);

    return {
      success: true,
      departments: serialize(live),
    };
  } catch (error) {
    console.error("getConfiguratorHubDepartments:", error);
    return { success: false, departments: [] };
  }
}

export async function getConfiguratorDepartmentPage(slug: string) {
  try {
    await connectDB();
    const department = await Department.findOne({
      slug: String(slug || "").toLowerCase(),
      isActive: true,
    }).lean();

    if (!department) {
      return { success: false, department: null, menus: [] };
    }

    const menus = await Menu.find({
      department: (department as any)._id,
      parent: null,
      isActive: { $ne: false },
    })
      .sort({ order: 1, name: 1 })
      .lean();

    return {
      success: true,
      department: serialize(department),
      menus: serialize(menus),
    };
  } catch (error) {
    console.error("getConfiguratorDepartmentPage:", error);
    return { success: false, department: null, menus: [] };
  }
}

/** Admin: all departments + configurator flag + live product counts */
export async function getAdminConfiguratorDepartments() {
  try {
    await connectDB();
    const departments = await Department.find({})
      .sort({ order: 1, name: 1 })
      .lean();
    const inactiveIds = await inactiveBrandIds();
    const withCounts = await Promise.all(
      departments.map(async (d: any) => {
        const productCount = await departmentProductCount(d, inactiveIds);
        return {
          ...d,
          showInConfigurator: Boolean(d.showInConfigurator),
          productCount,
        };
      }),
    );
    return {
      success: true,
      departments: serialize(withCounts),
    };
  } catch (error) {
    console.error("getAdminConfiguratorDepartments:", error);
    return { success: false, departments: [] };
  }
}

export async function setDepartmentConfiguratorVisibility(
  id: string,
  showInConfigurator: boolean,
) {
  try {
    await connectDB();
    const next = Boolean(showInConfigurator);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { success: false, error: "Invalid department id" };
    }
    const res = await Department.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { showInConfigurator: next, updatedAt: new Date() } },
    );
    if (!res.matchedCount) {
      return { success: false, error: "Department not found" };
    }

    const department = await Department.findById(id).lean();
    if (!department) return { success: false, error: "Department not found" };

    revalidateConfigurator();
    return {
      success: true,
      department: serialize({
        ...department,
        showInConfigurator: next,
      }),
    };
  } catch (error: any) {
    console.error("setDepartmentConfiguratorVisibility:", error);
    return { success: false, error: error.message || "Update failed" };
  }
}

export async function seedConfiguratorCategories() {
  return ensureConfiguratorDepartmentsEnabled();
}
