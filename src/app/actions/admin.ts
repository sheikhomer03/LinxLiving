"use server";

import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Menu } from "@/models/Menu";
import { revalidatePath } from "next/cache";
import { uploadImageToCloudinary } from "@/app/actions/storage";

export async function getProducts(page = 1, limit = 50) {
  try {
    await connectDB();
    const skip = (page - 1) * limit;
    const products = await Product.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const totalCount = await Product.countDocuments();
    return {
      products: JSON.parse(JSON.stringify(products)),
      totalCount,
    };
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return { products: [], totalCount: 0 };
  }
}

export async function getProduct(id: string) {
  try {
    await connectDB();
    const product = await Product.findById(id);
    if (!product) return null;
    return JSON.parse(JSON.stringify(product));
  } catch (error) {
    console.error("Failed to fetch product:", error);
    return null;
  }
}

export async function createProduct(formData: FormData) {
  try {
    await connectDB();

    // Extract product details from FormData
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const price = parseFloat(formData.get("price") as string);
    const stock = parseInt(formData.get("stock") as string);
    const category = formData.get("category") as string;
    const subCategory = formData.get("subCategory") as string;
    const specs = JSON.parse((formData.get("specs") as string) || "{}");
    const showSpecs = formData.get("showSpecs") === "true";
    const tagline = formData.get("tagline") as string;
    let schematicImage = formData.get("schematicImage") as string;

    const schematicFile = formData.get("schematicFile") as File;
    if (schematicFile && schematicFile.size > 0) {
      const uploadResult = await uploadImageToCloudinary(schematicFile);
      if (uploadResult.success && uploadResult.url) {
        schematicImage = uploadResult.url;
      }
    }

    // Process images
    const imageUrls: string[] = [];
    const existingImages = JSON.parse(
      (formData.get("images") as string) || "[]",
    );
    imageUrls.push(...existingImages);

    const imageFiles = formData.getAll("imageFiles") as File[];
    for (const file of imageFiles) {
      if (file.size > 0) {
        const uploadResult = await uploadImageToCloudinary(file);
        if (uploadResult.success && uploadResult.url) {
          imageUrls.push(uploadResult.url);
        }
      }
    }

    const product = await Product.create({
      name,
      description,
      price,
      stock,
      category,
      subCategory,
      specs,
      showSpecs,
      images: imageUrls,
      tagline,
      schematicImage,
    });

    revalidatePath("/admin/products");
    revalidatePath("/admin");
    return { success: true, product: JSON.parse(JSON.stringify(product)) };
  } catch (error) {
    console.error("Failed to create product:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateProduct(id: string, formData: FormData) {
  try {
    await connectDB();

    // Extract product details from FormData
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const price = parseFloat(formData.get("price") as string);
    const stock = parseInt(formData.get("stock") as string);
    const category = formData.get("category") as string;
    const subCategory = formData.get("subCategory") as string;
    const specs = JSON.parse((formData.get("specs") as string) || "{}");
    const showSpecs = formData.get("showSpecs") === "true";
    const tagline = formData.get("tagline") as string;
    let schematicImage = formData.get("schematicImage") as string;

    const schematicFile = formData.get("schematicFile") as File;
    if (schematicFile && schematicFile.size > 0) {
      const uploadResult = await uploadImageToCloudinary(schematicFile);
      if (uploadResult.success && uploadResult.url) {
        schematicImage = uploadResult.url;
      }
    }

    // Process images
    const imageUrls: string[] = [];
    const existingImages = JSON.parse(
      (formData.get("images") as string) || "[]",
    );
    imageUrls.push(...existingImages);

    const imageFiles = formData.getAll("imageFiles") as File[];
    for (const file of imageFiles) {
      if (file.size > 0) {
        const uploadResult = await uploadImageToCloudinary(file);
        if (uploadResult.success && uploadResult.url) {
          imageUrls.push(uploadResult.url);
        }
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      {
        name,
        description,
        price,
        stock,
        category,
        subCategory,
        specs,
        showSpecs,
        images: imageUrls,
        tagline,
        schematicImage,
      },
      { new: true },
    );

    revalidatePath("/admin/products");
    revalidatePath("/", "layout");
    return {
      success: true,
      product: JSON.parse(JSON.stringify(updatedProduct)),
    };
  } catch (error) {
    console.error("Failed to update product:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteProduct(id: string) {
  try {
    await connectDB();
    await Product.findByIdAndDelete(id);
    revalidatePath("/admin/products");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete product:", error);
    return { success: false, error: "Deletion failed" };
  }
}

export async function getCustomers(page = 1, limit = 50) {
  try {
    await connectDB();
    const skip = (page - 1) * limit;
    const customers = await User.find({ role: "user" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const totalCount = await User.countDocuments({ role: "user" });
    return {
      customers: JSON.parse(JSON.stringify(customers)),
      totalCount,
    };
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    return { customers: [], totalCount: 0 };
  }
}

export async function deleteCustomer(id: string) {
  try {
    await connectDB();
    await User.findByIdAndDelete(id);
    revalidatePath("/admin/customers");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete customer:", error);
    return { success: false, error: "Deletion failed" };
  }
}

export async function getCustomerWithOrders(id: string) {
  try {
    await connectDB();
    const customer = await User.findById(id);
    if (!customer) return null;

    const orders = await Order.find({ user: id }).sort({ createdAt: -1 });

    return {
      customer: JSON.parse(JSON.stringify(customer)),
      orders: JSON.parse(JSON.stringify(orders)),
    };
  } catch (error) {
    console.error("Failed to fetch customer details:", error);
    return null;
  }
}

// --- Menus ---

export async function getMenus() {
  try {
    await connectDB();
    const menus = await Menu.find().sort({ order: 1, name: 1 });
    return { success: true, menus: JSON.parse(JSON.stringify(menus)) };
  } catch (error) {
    console.error("Failed to fetch menus:", error);
    return { success: false, menus: [] };
  }
}

export async function getMenuTree() {
  try {
    await connectDB();
    const menus = await Menu.find().sort({ order: 1, name: 1 });
    const menuMap = new Map();
    const tree: any[] = [];

    menus.forEach((menu) => {
      const menuObj = { ...menu.toObject(), children: [] };
      menuMap.set(menu._id.toString(), menuObj);
    });

    menus.forEach((menu) => {
      const menuObj = menuMap.get(menu._id.toString());
      if (menu.parent) {
        const parent = menuMap.get(menu.parent.toString());
        if (parent) {
          parent.children.push(menuObj);
        } else {
          tree.push(menuObj);
        }
      } else {
        tree.push(menuObj);
      }
    });

    return { success: true, tree: JSON.parse(JSON.stringify(tree)) };
  } catch (error) {
    console.error("Failed to fetch menu tree:", error);
    return { success: false, tree: [] };
  }
}

export async function createMenu(formData: FormData) {
  try {
    await connectDB();
    const name = formData.get("name") as string;
    const slug = formData.get("slug") as string;
    const parent = (formData.get("parent") as string) || null;
    const order = parseInt((formData.get("order") as string) || "0");

    const menu = await Menu.create({
      name,
      slug,
      parent,
      order,
    });

    revalidatePath("/admin/menus");
    return { success: true, menu: JSON.parse(JSON.stringify(menu)) };
  } catch (error) {
    console.error("Failed to create menu:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateMenu(id: string, formData: FormData) {
  try {
    await connectDB();
    const name = formData.get("name") as string;
    const slug = formData.get("slug") as string;
    const parent = (formData.get("parent") as string) || null;
    const order = parseInt((formData.get("order") as string) || "0");

    const menu = await Menu.findByIdAndUpdate(
      id,
      { name, slug, parent, order },
      { new: true },
    );

    revalidatePath("/admin/menus");
    return { success: true, menu: JSON.parse(JSON.stringify(menu)) };
  } catch (error) {
    console.error("Failed to update menu:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteMenu(id: string) {
  try {
    await connectDB();
    // Check if it has children
    const childrenCount = await Menu.countDocuments({ parent: id });
    if (childrenCount > 0) {
      return {
        success: false,
        error:
          "Cannot delete menu with sub-categories. Delete sub-categories first.",
      };
    }

    await Menu.findByIdAndDelete(id);
    revalidatePath("/admin/menus");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete menu:", error);
    return { success: false, error: "Deletion failed" };
  }
}

export async function getMenuBySlug(slug: string) {
  try {
    await connectDB();
    const menu = await Menu.findOne({ slug });
    if (!menu) return null;
    return JSON.parse(JSON.stringify(menu));
  } catch (error) {
    console.error("Failed to fetch menu by slug:", error);
    return null;
  }
}

export async function getFirstSubCategorySlug() {
  try {
    await connectDB();
    // Find the first menu item that has a parent (a sub-category)
    const subCategory = await Menu.findOne({ parent: { $ne: null } }).sort({
      order: 1,
    });

    if (subCategory) {
      return subCategory.slug;
    }

    // Fallback: Find the first top-level menu if no sub-categories exist
    const firstMenu = await Menu.findOne({ parent: null }).sort({ order: 1 });
    return firstMenu ? firstMenu.slug : "lamp-shades"; // "tiles" as a hard fallback
  } catch (error) {
    console.error("Failed to fetch first sub-category slug:", error);
    return "lamp-shades";
  }
}
