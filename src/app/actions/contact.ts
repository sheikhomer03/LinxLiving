"use server";

import connectDB from "@/lib/mongodb";
import { ContactQuery } from "@/models/ContactQuery";
import { revalidatePath } from "next/cache";
import { sendContactConfirmationEmail, sendContactAdminNotification } from "@/lib/mail";

export async function submitInquiry(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const subject = formData.get("subject") as string;
  const message = formData.get("message") as string;

  if (!name || !email || !subject || !message) {
    return { success: false, error: "All fields are required" };
  }

  try {
    await connectDB();
    await ContactQuery.create({
      name,
      email,
      subject,
      message,
    });

    // Send emails
    try {
      await sendContactConfirmationEmail(email, name);
      await sendContactAdminNotification(name, email, subject, message);
    } catch (emailError) {
      console.error("Failed to send contact emails:", emailError);
      // We don't want to fail the whole submission if email fails, 
      // but the log will help debug.
    }

    revalidatePath("/admin/queries");
    return {
      success: true,
      message:
        "Your inquiry has been submitted successfully. We will get back to you soon!",
    };
  } catch (error) {
    console.error("Submit Inquiry Error:", error);
    return {
      success: false,
      error: "Failed to submit inquiry. Please try again later.",
    };
  }
}

export async function getQueries(page = 1, limit = 50) {
  try {
    await connectDB();
    const skip = (page - 1) * limit;
    const queries = await ContactQuery.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const totalCount = await ContactQuery.countDocuments();
    return {
      queries: JSON.parse(JSON.stringify(queries)),
      totalCount,
    };
  } catch (error) {
    console.error("Failed to fetch queries:", error);
    return { queries: [], totalCount: 0 };
  }
}

export async function getQuery(id: string) {
  try {
    await connectDB();
    const query = await ContactQuery.findById(id);
    if (!query) return null;
    return JSON.parse(JSON.stringify(query));
  } catch (error) {
    console.error("Failed to fetch query:", error);
    return null;
  }
}

export async function updateQueryStatus(id: string, status: string) {
  try {
    await connectDB();
    await ContactQuery.findByIdAndUpdate(id, { status });
    revalidatePath("/admin/queries");
    revalidatePath(`/admin/queries/${id}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to update query status:", error);
    return { success: false, error: "Update failed" };
  }
}
