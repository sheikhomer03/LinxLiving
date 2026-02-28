"use server";

import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendResetEmail, sendWelcomeEmail } from "@/lib/mail";
import crypto from "crypto";

export async function registerUser(formData: any) {
  try {
    const { name, email, password } = formData;

    if (!name || !email || !password) {
      return { error: "Please fill in all fields" };
    }

    await connectDB();

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return { error: "Email already registered" };
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: "user",
    });

    try {
      await sendWelcomeEmail(email, name);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
      // We don't fail registration if the welcome email fails
    }

    return { success: true };
  } catch (error: any) {
    console.error("Registration error:", error);
    return { error: "An unexpected error occurred" };
  }
}
export async function updateProfile(formData: {
  name: string;
  email?: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return { error: "Not authenticated" };
    }

    const { name, email } = formData;
    if (!name) {
      return { error: "Please enter your name" };
    }

    await connectDB();

    const updateData: any = { name };

    // If email is provided and being changed, check if it's already taken
    if (email && email !== session.user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return { error: "Email already in use" };
      }
      updateData.email = email;
    }

    const userId = (session.user as any).id;
    await User.findByIdAndUpdate(userId, updateData);

    return { success: true };
  } catch (error: any) {
    console.error("Profile update error:", error);
    return { error: "An unexpected error occurred" };
  }
}

export async function changePassword(formData: any) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return { error: "Not authenticated" };
    }

    const { currentPassword, newPassword } = formData;
    if (!currentPassword || !newPassword) {
      return { error: "Please fill in all fields" };
    }

    await connectDB();
    const userId = (session.user as any).id;
    const user = await User.findById(userId);

    if (!user || !user.password) {
      return { error: "User not found" };
    }

    const isPasswordCorrect = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordCorrect) {
      return { error: "Incorrect current password" };
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedNewPassword;
    await user.save();

    return { success: true };
  } catch (error: any) {
    console.error("Password change error:", error);
    return { error: "An unexpected error occurred" };
  }
}

export async function requestPasswordReset(email: string) {
  try {
    if (!email) return { error: "Please enter your email" };

    await connectDB();
    const user = await User.findOne({ email });
    if (!user) {
      // Return success even if user not found to prevent email enumeration
      return { success: true };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");

    user.resetOTP = hashedOTP;
    user.resetOTPExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 mins
    await user.save();

    await sendResetEmail(email, otp);

    return { success: true };
  } catch (error) {
    console.error("Reset request error:", error);
    return { error: "Failed to send reset email" };
  }
}

export async function verifyOTP(email: string, otp: string) {
  try {
    if (!email || !otp) return { error: "Missing information" };

    await connectDB();
    const user = await User.findOne({ email });

    if (!user || !user.resetOTP || !user.resetOTPExpiry) {
      return { error: "Invalid request" };
    }

    if (user.resetOTPExpiry < new Date()) {
      return { error: "OTP has expired" };
    }

    const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");
    if (hashedOTP !== user.resetOTP) {
      return { error: "Incorrect verification code" };
    }

    return { success: true };
  } catch (error) {
    console.error("OTP verification error:", error);
    return { error: "Failed to verify code" };
  }
}

export async function resetPassword(formData: any) {
  try {
    const { email, otp, password } = formData;
    if (!email || !otp || !password) return { error: "Missing information" };

    await connectDB();
    const user = await User.findOne({ email });

    if (!user || user.resetOTPExpiry < new Date()) {
      return { error: "Invalid or expired session" };
    }

    const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");
    if (hashedOTP !== user.resetOTP) {
      return { error: "Invalid verification code" };
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    user.password = hashedPassword;
    user.resetOTP = undefined;
    user.resetOTPExpiry = undefined;
    await user.save();

    return { success: true };
  } catch (error) {
    console.error("Password reset error:", error);
    return { error: "Failed to reset password" };
  }
}
