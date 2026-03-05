"use server";

import connectDB from "@/lib/mongodb";
import { Subscriber } from "@/models/Subscriber";
import { revalidatePath } from "next/cache";

export async function subscribeToNewsletter(formData: FormData) {
  const email = formData.get("email") as string;

  if (!email) {
    return { success: false, error: "Email is required" };
  }

  try {
    await connectDB();

    // Check if already exists
    const existing = await Subscriber.findOne({ email });
    if (existing) {
      return { success: false, error: "This email is already subscribed" };
    }

    await Subscriber.create({ email });

    revalidatePath("/admin/subscribers");
    return {
      success: true,
      message: "Thank you for joining our inner circle!",
    };
  } catch (error: any) {
    console.error("Newsletter subscription error:", error);
    if (error.code === 11000) {
      return { success: false, error: "This email is already subscribed" };
    }
    return {
      success: false,
      error: "Subscription failed. Please try again later.",
    };
  }
}

export async function getSubscribers() {
  try {
    await connectDB();
    const subscribers = await Subscriber.find().sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(subscribers));
  } catch (error) {
    console.error("Failed to fetch subscribers:", error);
    return [];
  }
}
