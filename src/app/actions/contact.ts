"use server";

import connectDB from "@/lib/mongodb";
import { ContactQuery } from "@/models/ContactQuery";
import { revalidatePath } from "next/cache";

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

export async function getQueries() {
  try {
    await connectDB();
    const queries = await ContactQuery.find().sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(queries));
  } catch (error) {
    console.error("Failed to fetch queries:", error);
    return [];
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
