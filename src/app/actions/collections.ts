"use server";

import connectDB from "@/lib/mongodb";
import { Collection } from "@/models/Collection";

export async function getPublicCollections() {
  try {
    await connectDB();
    const collections = await Collection.find().sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(collections));
  } catch (error) {
    console.error("Failed to fetch public collections:", error);
    return [];
  }
}

export async function getCollectionBySlug(slug: string) {
  try {
    await connectDB();
    const collection = await Collection.findOne({
      slug,
    });
    if (!collection) return null;
    return JSON.parse(JSON.stringify(collection));
  } catch (error) {
    console.error("Failed to fetch collection by slug:", error);
    return null;
  }
}
