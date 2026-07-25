"use server";

import { cache } from "react";
import connectDB from "@/lib/mongodb";
import { Settings } from "@/models/Settings";
import { User } from "@/models/User";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { getServerSession } from "next-auth";

export async function getSettings() {
  try {
    await connectDB();
    let settings = await Settings.findOne().lean();
    if (!settings) {
      settings = await Settings.create({});
      return JSON.parse(JSON.stringify(settings));
    }
    return JSON.parse(JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return null;
  }
}

/** Deduped per request when called from multiple Server Components. */
export const getStoreName = cache(async () => {
  try {
    await connectDB();
    const settings = await Settings.findOne().select("storeName").lean();
    return settings?.storeName || "Linx Square";
  } catch (error) {
    console.error("Failed to fetch store name:", error);
    return "Linx Square";
  }
});

export async function updateAccountSettings(formData: any) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    await connectDB();

    // 1. Update general store settings (only storeName now)
    await Settings.findOneAndUpdate(
      {},
      { storeName: formData.storeName },
      { upsert: true },
    );

    // 2. Update the actual user's name in the DB if adminName is provided
    if (formData.adminName) {
      await User.findOneAndUpdate(
        { email: session.user.email },
        { name: formData.adminName },
      );
    }

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error("Failed to update account settings:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function updateSecuritySettings(data: any) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    await connectDB();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return { success: false, error: "User not found" };

    const isMatch = await bcrypt.compare(data.currentPassword, user.password);
    if (!isMatch)
      return { success: false, error: "Current password incorrect" };

    const hashedPassword = await bcrypt.hash(data.newPassword, 12);
    user.password = hashedPassword;
    await user.save();

    return { success: true };
  } catch (error) {
    console.error("Failed to update security settings:", error);
    return { success: false, error: "Security update failed" };
  }
}

export async function verifyAndSaveResend(data: any) {
  try {
    const resend = new Resend(data.resendApiKey);
    const fromEmail = data.emailFrom || "info@linxliving.co.uk";
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: fromEmail,
      subject: "Verification",
      html: "<p>Verifying API Key</p>",
    });

    if (error) {
      console.error("Resend verification failed:", error);
      return { success: false, error: "Invalid Resend API Key" };
    }

    // 2. If verified, save to DB
    await connectDB();
    await Settings.findOneAndUpdate(
      {},
      {
        resendApiKey: data.resendApiKey,
        emailFrom: data.emailFrom,
      },
      { upsert: true },
    );

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error: any) {
    console.error("Resend Verification failed:", error);
    return {
      success: false,
      error: "Resend API verification failed. Please check your credentials.",
    };
  }
}
