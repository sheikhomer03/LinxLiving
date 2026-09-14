"use server";

import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import connectDB from "@/lib/mongodb";
import { authOptions } from "@/lib/auth";
import { User } from "@/models/User";
import { Department } from "@/models/Department";
import {
  sendTradeApplicationAdminNotification,
  sendTradeApprovedEmail,
  sendTradeRejectedEmail,
} from "@/lib/mail";
import { describeTradeDepartments, TRADE_ALL_DEPARTMENTS } from "@/lib/trade";

/**
 * Trade account applications.
 *
 * The flow is: apply at /trade → `tradeStatus: "pending"` and staff are
 * emailed → an admin approves or declines at /admin/trade-accounts → the
 * applicant is emailed either way. Sign-in is refused for anything but
 * "approved" (see lib/auth.ts), so an account is never usable before it has
 * been reviewed.
 */

type ActionResult = { success: true } | { error: string };

/** Only an admin may read or decide applications. */
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "admin") return null;
  return session;
}

/** Department slugs that actually exist, so an application cannot invent one. */
async function validDepartmentSlugs(): Promise<Map<string, string>> {
  await connectDB();
  const departments = await Department.find({})
    .select("slug name")
    .lean<{ slug?: string; name?: string }[]>();
  const map = new Map<string, string>();
  for (const d of departments) {
    const slug = String(d?.slug || "").trim().toLowerCase();
    if (slug) map.set(slug, String(d?.name || slug));
  }
  return map;
}

/** Department list for the application form and the admin filter. */
export async function getTradeDepartmentOptions() {
  try {
    await connectDB();
    const departments = await Department.find({ isActive: true })
      .select("slug name")
      .sort({ order: 1, name: 1 })
      .lean<{ slug?: string; name?: string }[]>();
    return {
      success: true,
      departments: departments
        .map((d) => ({
          slug: String(d?.slug || "").trim().toLowerCase(),
          name: String(d?.name || ""),
        }))
        .filter((d) => d.slug && d.name),
    };
  } catch (error) {
    console.error("getTradeDepartmentOptions:", error);
    return { success: false, departments: [] };
  }
}

export async function applyForTradeAccount(input: {
  name: string;
  email: string;
  password: string;
  companyName?: string;
  phone?: string;
  /** Slugs, or ["all"] / [] for every department. */
  departments: string[];
}): Promise<ActionResult> {
  try {
    const name = String(input?.name || "").trim();
    const email = String(input?.email || "").trim().toLowerCase();
    const password = String(input?.password || "");
    const companyName = String(input?.companyName || "").trim();
    const phone = String(input?.phone || "").trim();

    if (!name || !email || !password) {
      return { error: "Please fill in all required fields" };
    }
    if (!email.includes("@")) {
      return { error: "Please enter a valid email address" };
    }
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters" };
    }

    // "All departments" is stored as an empty list, so the meaning lives in one
    // place (lib/trade.ts) rather than in a magic slug spread across the code.
    const requested = (input?.departments || [])
      .map((d) => String(d || "").trim().toLowerCase())
      .filter(Boolean);
    const wantsAll =
      requested.length === 0 || requested.includes(TRADE_ALL_DEPARTMENTS);

    const known = await validDepartmentSlugs();
    const departments = wantsAll
      ? []
      : [...new Set(requested.filter((slug) => known.has(slug)))];

    if (!wantsAll && !departments.length) {
      return { error: "Please choose at least one department" };
    }

    await connectDB();

    const existing = await User.findOne({ email });
    if (existing) {
      // Deliberately specific: an applicant who forgot they already applied
      // needs to know which of the three states they are in, and none of this
      // leaks anything they could not learn from the sign-in form anyway.
      if (existing.tradeStatus === "pending") {
        return {
          error:
            "An application for this email is already awaiting approval. We will email you when it is reviewed.",
        };
      }
      if (existing.tradeStatus === "approved") {
        return { error: "This email already has an approved trade account. Please sign in." };
      }
      return { error: "This email is already registered. Please sign in instead." };
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await User.create({
      name,
      email,
      password: hashedPassword,
      role: "user",
      // Never granted here — only approval sets it. See models/User.ts.
      isTradeAccount: false,
      tradeStatus: "pending",
      tradeDepartments: departments,
      tradeCompanyName: companyName,
      tradePhone: phone,
      tradeAppliedAt: new Date(),
    });

    try {
      await sendTradeApplicationAdminNotification({
        name,
        email,
        companyName,
        phone,
        departments: describeTradeDepartments(departments, (slug) =>
          known.get(slug),
        ),
      });
    } catch (emailError) {
      // The application is saved either way — a failed notification must not
      // lose it. It is still visible in the admin list.
      console.error("Trade application admin email failed:", emailError);
    }

    return { success: true };
  } catch (error) {
    console.error("applyForTradeAccount:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

/** The fields the admin list reads off a user document. */
type TradeUserDoc = {
  _id: unknown;
  name?: string;
  email?: string;
  tradeCompanyName?: string;
  tradePhone?: string;
  tradeStatus?: string;
  tradeDepartments?: unknown[];
  tradeAppliedAt?: Date | string | null;
  tradeApprovedAt?: Date | string | null;
  tradeRejectedAt?: Date | string | null;
  tradeReviewNote?: string;
};

export type TradeApplication = {
  id: string;
  name: string;
  email: string;
  companyName: string;
  phone: string;
  status: "none" | "pending" | "approved" | "rejected";
  departments: string[];
  departmentsLabel: string;
  appliedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  reviewNote: string;
};

export async function getTradeApplications(status?: string) {
  const session = await requireAdmin();
  if (!session) return { success: false, applications: [] as TradeApplication[] };

  try {
    await connectDB();
    const query: Record<string, unknown> =
      status && status !== "all"
        ? { tradeStatus: status }
        : { tradeStatus: { $in: ["pending", "approved", "rejected"] } };

    const users = await User.find(query)
      .select(
        "name email tradeCompanyName tradePhone tradeStatus tradeDepartments tradeAppliedAt tradeApprovedAt tradeRejectedAt tradeReviewNote",
      )
      .sort({ tradeAppliedAt: -1, createdAt: -1 })
      .lean<TradeUserDoc[]>();

    const known = await validDepartmentSlugs();

    return {
      success: true,
      applications: users.map((u): TradeApplication => {
        const departments = (u.tradeDepartments || []).map((d: unknown) =>
          String(d),
        );
        return {
          id: String(u._id),
          name: String(u.name || ""),
          email: String(u.email || ""),
          companyName: String(u.tradeCompanyName || ""),
          phone: String(u.tradePhone || ""),
          status: (u.tradeStatus || "none") as TradeApplication["status"],
          departments,
          departmentsLabel: describeTradeDepartments(departments, (slug) =>
            known.get(slug),
          ),
          appliedAt: u.tradeAppliedAt
            ? new Date(u.tradeAppliedAt).toISOString()
            : null,
          approvedAt: u.tradeApprovedAt
            ? new Date(u.tradeApprovedAt).toISOString()
            : null,
          rejectedAt: u.tradeRejectedAt
            ? new Date(u.tradeRejectedAt).toISOString()
            : null,
          reviewNote: String(u.tradeReviewNote || ""),
        };
      }),
    };
  } catch (error) {
    console.error("getTradeApplications:", error);
    return { success: false, applications: [] as TradeApplication[] };
  }
}

/**
 * Approve an application.
 *
 * `departments` lets the admin narrow (or widen) what the applicant asked for
 * before granting it — an empty list means every department. `isTradeAccount`
 * is set here and nowhere else, so it can never drift from `tradeStatus`.
 */
export async function approveTradeAccount(
  userId: string,
  departments?: string[],
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { error: "Not authorised" };

  try {
    await connectDB();
    const user = await User.findById(userId);
    if (!user) return { error: "Account not found" };

    const known = await validDepartmentSlugs();
    const requested: string[] = (
      departments ??
      (user.tradeDepartments as unknown[] | undefined) ??
      []
    ).map((d: unknown) => String(d || "").trim().toLowerCase());
    const scoped = requested.includes(TRADE_ALL_DEPARTMENTS)
      ? []
      : [...new Set(requested.filter((slug: string) => known.has(slug)))];

    user.isTradeAccount = true;
    user.tradeStatus = "approved";
    user.tradeDepartments = scoped;
    user.tradeApprovedAt = new Date();
    user.tradeRejectedAt = null;
    user.tradeReviewNote = "";
    await user.save();

    try {
      await sendTradeApprovedEmail(
        user.email,
        user.name,
        describeTradeDepartments(scoped, (slug) => known.get(slug)),
      );
    } catch (emailError) {
      // Approval stands even if the email bounces — the account works, and the
      // admin can see from the table that it was approved.
      console.error("Trade approval email failed:", emailError);
    }

    revalidatePath("/admin/trade-accounts");
    return { success: true };
  } catch (error) {
    console.error("approveTradeAccount:", error);
    return { error: "Could not approve this account" };
  }
}

export async function rejectTradeAccount(
  userId: string,
  note?: string,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { error: "Not authorised" };

  try {
    await connectDB();
    const user = await User.findById(userId);
    if (!user) return { error: "Account not found" };

    user.isTradeAccount = false;
    user.tradeStatus = "rejected";
    user.tradeRejectedAt = new Date();
    user.tradeApprovedAt = null;
    user.tradeReviewNote = String(note || "").trim();
    await user.save();

    try {
      await sendTradeRejectedEmail(user.email, user.name, user.tradeReviewNote);
    } catch (emailError) {
      console.error("Trade rejection email failed:", emailError);
    }

    revalidatePath("/admin/trade-accounts");
    return { success: true };
  } catch (error) {
    console.error("rejectTradeAccount:", error);
    return { error: "Could not update this account" };
  }
}

/**
 * Withdraw an approved account without deleting it.
 *
 * Back to "pending" rather than "rejected": revoking is usually a review, not
 * a refusal, and pending is equally locked out of sign-in.
 */
export async function revokeTradeAccount(userId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { error: "Not authorised" };

  try {
    await connectDB();
    const user = await User.findById(userId);
    if (!user) return { error: "Account not found" };

    user.isTradeAccount = false;
    user.tradeStatus = "pending";
    user.tradeApprovedAt = null;
    await user.save();

    revalidatePath("/admin/trade-accounts");
    return { success: true };
  } catch (error) {
    console.error("revokeTradeAccount:", error);
    return { error: "Could not update this account" };
  }
}
