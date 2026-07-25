"use server";
import connectDB from "@/lib/mongodb";
import { Address } from "@/models/Address";
import { User } from "@/models/User";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function syncAddressToShopify(userId: string, address: any) {
  try {
    const { isShopifySyncEnabled } = await import("@/lib/shopify");
    if (!isShopifySyncEnabled()) return;

    const user = await User.findById(userId).select(
      "name email shopifyCustomerId",
    );
    if (!user) return;

    const { pushCustomerToShopify, pushAddressToShopify } = await import(
      "@/lib/shopify/sync-commerce"
    );
    let customerId = user.shopifyCustomerId;
    if (!customerId) {
      customerId = await pushCustomerToShopify({
        name: user.name,
        email: user.email,
      });
      if (customerId) {
        user.shopifyCustomerId = customerId;
        user.shopifySyncedAt = new Date();
        await user.save();
      }
    }
    if (!customerId) return;

    const shopifyAddressId = await pushAddressToShopify({
      shopifyCustomerId: customerId,
      shopifyAddressId: address.shopifyAddressId,
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company,
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      county: address.county,
      postcode: address.postcode,
      country: address.country,
    });
    if (shopifyAddressId) {
      address.shopifyAddressId = shopifyAddressId;
      address.shopifySyncedAt = new Date();
      await address.save();
    }
  } catch (error) {
    console.error("Shopify address sync failed:", error);
  }
}

export async function getAddresses() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { error: "Not authenticated" };

    await connectDB();
    const userId = (session.user as any).id;
    const addresses = await Address.find({ user: userId }).sort({
      createdAt: -1,
    });

    return { success: true, addresses: JSON.parse(JSON.stringify(addresses)) };
  } catch (error) {
    console.error("Fetch addresses error:", error);
    return { error: "Failed to fetch addresses" };
  }
}

export async function addAddress(formData: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { error: "Not authenticated" };

    await connectDB();
    const userId = (session.user as any).id;

    const count = await Address.countDocuments({ user: userId });
    const isDefault = count === 0;

    const address = await Address.create({
      ...formData,
      user: userId,
      isDefault,
    });

    await syncAddressToShopify(userId, address);

    revalidatePath("/profile");
    return { success: true, address: JSON.parse(JSON.stringify(address)) };
  } catch (error) {
    console.error("Add address error:", error);
    return { error: "Failed to add address" };
  }
}

export async function updateAddress(id: string, formData: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { error: "Not authenticated" };

    await connectDB();
    const userId = (session.user as any).id;

    const address = await Address.findOneAndUpdate(
      { _id: id, user: userId },
      formData,
      { new: true },
    );

    if (!address) return { error: "Address not found" };

    await syncAddressToShopify(userId, address);

    revalidatePath("/profile");
    return { success: true, address: JSON.parse(JSON.stringify(address)) };
  } catch (error) {
    console.error("Update address error:", error);
    return { error: "Failed to update address" };
  }
}

export async function deleteAddress(id: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { error: "Not authenticated" };

    await connectDB();
    const userId = (session.user as any).id;

    const address = await Address.findOne({ _id: id, user: userId });
    if (!address) return { error: "Address not found" };

    try {
      const { isShopifySyncEnabled } = await import("@/lib/shopify");
      if (
        isShopifySyncEnabled() &&
        address.shopifyAddressId
      ) {
        const user = await User.findById(userId).select("shopifyCustomerId");
        if (user?.shopifyCustomerId) {
          const { deleteShopifyAddress } = await import(
            "@/lib/shopify/sync-commerce"
          );
          await deleteShopifyAddress(
            user.shopifyCustomerId,
            address.shopifyAddressId,
          );
        }
      }
    } catch (error) {
      console.error("Shopify address delete failed:", error);
    }

    await Address.findOneAndDelete({ _id: id, user: userId });

    revalidatePath("/profile");
    return { success: true };
  } catch (error) {
    console.error("Delete address error:", error);
    return { error: "Failed to delete address" };
  }
}
