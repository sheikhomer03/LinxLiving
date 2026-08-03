"use server";

import connectDB from "@/lib/mongodb";
import { ContactQuery } from "@/models/ContactQuery";
import { revalidatePath } from "next/cache";
import { sendContactConfirmationEmail, sendContactAdminNotification } from "@/lib/mail";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export async function submitInquiry(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const subject = String(formData.get("subject") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const company = String(formData.get("company") || "").trim();
  const consent = formData.get("consent");
  // Hidden field real users never fill in — bots complete every input.
  const honeypot = String(formData.get("website") || "").trim();

  if (honeypot) {
    // Silently accept so the bot does not learn it was blocked.
    console.warn("Contact form honeypot triggered — submission dropped.");
    return {
      success: true,
      message:
        "Your inquiry has been submitted successfully. We will get back to you soon!",
    };
  }

  if (!name || !email || !subject || !message) {
    return { success: false, error: "All fields are required" };
  }

  if (!consent) {
    return {
      success: false,
      error: "Please agree to us storing your details so we can reply.",
    };
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { success: false, error: "Please enter a valid email address" };
  }

  if (message.length > 5000 || subject.length > 200 || name.length > 100) {
    return { success: false, error: "Your message is too long" };
  }

  // 3 enquiries per 10 minutes per IP, and 5 per hour for the same email.
  const ip = await getClientIp();
  const byIp = checkRateLimit(`contact:ip:${ip}`, 3, 10 * 60 * 1000);
  if (!byIp.allowed) {
    return {
      success: false,
      error: `Too many enquiries. Please try again in ${Math.ceil(byIp.retryAfterSeconds / 60)} minutes.`,
    };
  }

  const byEmail = checkRateLimit(
    `contact:email:${email.toLowerCase()}`,
    5,
    60 * 60 * 1000,
  );
  if (!byEmail.allowed) {
    return {
      success: false,
      error: "We've already received several enquiries from you — we'll reply shortly.",
    };
  }

  try {
    await connectDB();
    const inquiry = await ContactQuery.create({
      name,
      email,
      subject,
      message,
      phone,
      company,
      consentGivenAt: new Date(),
    });

    try {
      const { isShopifySyncEnabled } = await import("@/lib/shopify");
      if (isShopifySyncEnabled()) {
        const { pushInquiryToShopify } = await import(
          "@/lib/shopify/sync-message"
        );
        const shopifyId = await pushInquiryToShopify({
          name,
          email,
          subject,
          message,
          status: "pending",
        });
        if (shopifyId) {
          inquiry.shopifyMetaobjectId = shopifyId;
          inquiry.shopifySyncedAt = new Date();
          await inquiry.save();
        }
      }
    } catch (shopifyError) {
      console.error("Shopify inquiry sync failed:", shopifyError);
    }

    // Send emails. The enquiry is already saved, so a failure here must not
    // lose the submission — but it must be loud, not silent.
    let notified = false;
    try {
      await sendContactAdminNotification(name, email, subject, message, {
        phone,
        company,
      });
      notified = true;
    } catch (emailError) {
      console.error(
        "ALERT: contact enquiry saved but staff notification failed:",
        emailError,
      );
    }

    try {
      await sendContactConfirmationEmail(email, name);
    } catch (emailError) {
      console.error("Contact confirmation to customer failed:", emailError);
    }

    if (!notified) {
      inquiry.notificationFailed = true;
      await inquiry.save().catch(() => {});
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
    const inquiry = await ContactQuery.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );

    if (inquiry) {
      try {
        const { isShopifySyncEnabled } = await import("@/lib/shopify");
        if (isShopifySyncEnabled()) {
          const { pushInquiryToShopify } = await import(
            "@/lib/shopify/sync-message"
          );
          const shopifyId = await pushInquiryToShopify({
            name: inquiry.name,
            email: inquiry.email,
            subject: inquiry.subject,
            message: inquiry.message,
            status: inquiry.status,
            shopifyMetaobjectId: inquiry.shopifyMetaobjectId,
          });
          if (shopifyId) {
            inquiry.shopifyMetaobjectId = shopifyId;
            inquiry.shopifySyncedAt = new Date();
            await inquiry.save();
          }
        }
      } catch (shopifyError) {
        console.error("Shopify inquiry status sync failed:", shopifyError);
      }
    }

    revalidatePath("/admin/queries");
    revalidatePath(`/admin/queries/${id}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to update query status:", error);
    return { success: false, error: "Update failed" };
  }
}
