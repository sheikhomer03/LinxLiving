"use server";

import connectDB from "@/lib/mongodb";
import { Wishlist } from "@/models/Wishlist";
import { Product } from "@/models/Product";
import { User } from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import mongoose from "mongoose";

export async function getWishlist() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { success: false, error: "Unauthorized" };

    await connectDB();
    const user = await User.findById((session.user as any).id);

    if (!user || !user.wishlist || user.wishlist.length === 0) {
      return { success: true, items: [] };
    }

    // Manually fetch products to be safe, as populate can be flaky with HMR/Model registration
    const products = await Product.find({
      _id: { $in: user.wishlist },
    });

    return {
      success: true,
      items: products.map((p: any) => ({
        id: p._id.toString(),
        name: p.name,
        price: p.price,
        image: p.images?.[0] || "",
        category: p.category,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function addToWishlist(productId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();
    const userId = (session.user as any).id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { success: false, error: "Invalid product ID format" };
    }

    let wishlist = await Wishlist.findOne({ user: userId });

    if (!wishlist) {
      wishlist = new Wishlist({ user: userId, products: [] });
    }

    const isAlreadyInWishlist = wishlist.products.some(
      (id: any) => id.toString() === productId,
    );

    if (!isAlreadyInWishlist) {
      wishlist.products.push(new mongoose.Types.ObjectId(productId));
      await wishlist.save();
    }

    // Sync to User model also
    await User.findByIdAndUpdate(userId, {
      $addToSet: { wishlist: new mongoose.Types.ObjectId(productId) },
    });

    return { success: true };
  } catch (error: any) {
    console.error("addToWishlist error:", error);
    return { success: false, error: error.message };
  }
}

export async function removeFromWishlist(productId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return { success: false, error: "Unauthorized" };
    }

    await connectDB();
    const userId = (session.user as any).id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return { success: false, error: "Invalid product ID format" };
    }

    const wishlist = await Wishlist.findOne({ user: userId });

    if (wishlist) {
      wishlist.products = wishlist.products.filter(
        (id: any) => id.toString() !== productId,
      );
      await wishlist.save();
    }

    // Sync to User model also
    await User.findByIdAndUpdate(userId, {
      $pull: { wishlist: new mongoose.Types.ObjectId(productId) },
    });

    return { success: true };
  } catch (error: any) {
    console.error("removeFromWishlist error:", error);
    return { success: false, error: error.message };
  }
}
export async function clearWishlist() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { success: false, error: "Unauthorized" };

    await connectDB();
    const userId = (session.user as any).id;

    // Clear standalone Wishlist
    await Wishlist.findOneAndUpdate({ user: userId }, { products: [] });

    // Clear User model wishlist
    await User.findByIdAndUpdate(userId, { wishlist: [] });

    return { success: true };
  } catch (error: any) {
    console.error("clearWishlist error:", error);
    return { success: false, error: error.message };
  }
}
