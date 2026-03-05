"use server";

import connectDB from "@/lib/mongodb";
import { Collection } from "@/models/Collection";

export async function getPublicCollections(limit: number = 0) {
  try {
    await connectDB();
    let query = Collection.find().sort({ createdAt: -1 });
    if (limit > 0) query = query.limit(limit);
    const collections = await query;
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
