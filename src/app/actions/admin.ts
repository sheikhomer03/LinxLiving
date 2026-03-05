"use server";

import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { revalidatePath } from "next/cache";
import { uploadImageToCloudinary } from "@/app/actions/storage";

export async function getProducts() {
  try {
    await connectDB();
    const products = await Product.find().sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(products));
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return [];
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
    const specs = JSON.parse((formData.get("specs") as string) || "{}");
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
      specs,
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
    const specs = JSON.parse((formData.get("specs") as string) || "{}");
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

    const product = await Product.findByIdAndUpdate(
      id,
      {
        name,
        description,
        price,
        stock,
        category,
        specs,
        images: imageUrls,
        tagline,
        schematicImage,
      },
      { new: true },
    );

    revalidatePath("/admin/products");
    return { success: true, product: JSON.parse(JSON.stringify(product)) };
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

export async function getCustomers() {
  try {
    await connectDB();
    const customers = await User.find({ role: "user" }).sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(customers));
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    return [];
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

// --- Collections ---

export async function getCollections() {
  try {
    await connectDB();
    const { Collection } = await import("@/models/Collection");
    const collections = await Collection.find().sort({ createdAt: -1 });

    // Calculate product count for each collection
    const collectionsWithCounts = await Promise.all(
      collections.map(async (collection) => {
        const productCount = await Product.countDocuments({
          category: collection.slug,
        });
        return {
          ...collection.toObject(),
          productCount,
        };
      }),
    );

    return JSON.parse(JSON.stringify(collectionsWithCounts));
  } catch (error) {
    console.error("Failed to fetch collections:", error);
    return [];
  }
}

export async function getCollection(id: string) {
  try {
    await connectDB();
    const { Collection } = await import("@/models/Collection");
    const collection = await Collection.findById(id);
    if (!collection) return null;
    return JSON.parse(JSON.stringify(collection));
  } catch (error) {
    console.error("Failed to fetch collection:", error);
    return null;
  }
}

export async function createCollection(formData: FormData) {
  try {
    await connectDB();
    const { Collection } = await import("@/models/Collection");

    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const slug = formData.get("slug") as string;
    let image = formData.get("image") as string;

    const imageFile = formData.get("imageFile") as File;
    if (imageFile && imageFile.size > 0) {
      const uploadResult = await uploadImageToCloudinary(imageFile);
      if (uploadResult.success && uploadResult.url) {
        image = uploadResult.url;
      }
    }

    const collection = await Collection.create({
      name,
      description,
      slug,
      image,
    });

    revalidatePath("/admin/collections");
    return {
      success: true,
      collection: JSON.parse(JSON.stringify(collection)),
    };
  } catch (error) {
    console.error("Failed to create collection:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateCollection(id: string, formData: FormData) {
  try {
    await connectDB();
    const { Collection } = await import("@/models/Collection");

    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const slug = formData.get("slug") as string;
    let image = formData.get("image") as string;

    const imageFile = formData.get("imageFile") as File;
    if (imageFile && imageFile.size > 0) {
      const uploadResult = await uploadImageToCloudinary(imageFile);
      if (uploadResult.success && uploadResult.url) {
        image = uploadResult.url;
      }
    }

    const collection = await Collection.findByIdAndUpdate(
      id,
      {
        name,
        description,
        slug,
        image,
      },
      { new: true },
    );

    revalidatePath("/admin/collections");
    return {
      success: true,
      collection: JSON.parse(JSON.stringify(collection)),
    };
  } catch (error) {
    console.error("Failed to update collection:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteCollection(id: string) {
  try {
    await connectDB();
    const { Collection } = await import("@/models/Collection");
    await Collection.findByIdAndDelete(id);
    revalidatePath("/admin/collections");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete collection:", error);
    return { success: false, error: "Deletion failed" };
  }
}
