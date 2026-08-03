"use server";

import {
  getConfiguratorDepartmentPage,
  getConfiguratorHubDepartments,
} from "@/app/actions/configuratorCategories";

export async function listConfiguratorCategories() {
  const { departments } = await getConfiguratorHubDepartments();
  return {
    success: true,
    categories: departments.map((d: any) => ({
      slug: d.slug,
      name: d.name,
      description: d.description,
      order: d.order,
    })),
  };
}

export async function listConfiguratorCategory(slug: string) {
  const page = await getConfiguratorDepartmentPage(slug);
  if (!page.department) return { success: false, error: "Department not found" };
  return {
    success: true,
    category: page.department,
    menus: page.menus || [],
  };
}
