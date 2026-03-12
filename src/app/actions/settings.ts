"use server";

import connectDB from "@/lib/mongodb";
import { Settings } from "@/models/Settings";
import { User } from "@/models/User";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { getServerSession } from "next-auth";

export async function getSettings() {
  try {
    await connectDB();
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    return JSON.parse(JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return null;
  }
}

export async function getStoreName() {
  try {
    await connectDB();
    const settings = await Settings.findOne().select("storeName").lean();
    return settings?.storeName || "Linx Market";
  } catch (error) {
    console.error("Failed to fetch store name:", error);
    return "Linx Market";
  }
}

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

export async function verifyAndSaveSmtp(data: any) {
  try {
    const host = "smtp.gmail.com";
    const port = 465;

    // 1. Verify credentials first
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: true, // true for 465
      auth: {
        user: data.smtpUser,
        pass: data.smtpPass,
      },
    });

    await transporter.verify();

    // 2. If verified, save to DB
    await connectDB();
    await Settings.findOneAndUpdate(
      {},
      {
        smtpHost: host,
        smtpPort: port,
        smtpUser: data.smtpUser,
        smtpPass: data.smtpPass,
      },
      { upsert: true },
    );

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error: any) {
    console.error("SMTP Verification failed:", error);
    return {
      success: false,
      error:
        "Gmail App Password verification failed. Please check your credentials.",
    };
  }
}
