"use server";

import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: "2023-10-16" as any,
  });
}

export async function getStripeTransactions(cursor?: string, status?: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      throw new Error("Unauthorized");
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new Error("Stripe is not configured (Shopify checkout is active)");
    }

    let results;
    if (status && status !== "all") {
      let query =
        status === "refunded" ? "refunded:true" : `status:"${status}"`;

      const searchParams: Stripe.ChargeSearchParams = {
        query,
        limit: 10,
      };
      if (cursor) {
        searchParams.page = cursor;
      }
      const searchResults = await stripe.charges.search(searchParams);
      results = {
        data: searchResults.data,
        has_more: searchResults.has_more,
        next_page: searchResults.next_page,
      };
    } else {
      const listParams: Stripe.ChargeListParams = {
        limit: 10,
      };
      if (cursor) {
        listParams.starting_after = cursor;
      }
      const listResults = await stripe.charges.list(listParams);
      results = {
        data: listResults.data,
        has_more: listResults.has_more,
        next_page:
          listResults.data.length > 0
            ? listResults.data[listResults.data.length - 1].id
            : null,
      };
    }

    return {
      success: true,
      data: JSON.parse(JSON.stringify(results.data)),
      hasMore: results.has_more,
      lastId: results.next_page,
    };
  } catch (error: any) {
    console.error("Stripe Fetch Error:", error);
    return { success: false, error: error.message };
  }
}

export async function refundStripeCharge(chargeId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      throw new Error("Unauthorized");
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new Error("Stripe is not configured (Shopify checkout is active)");
    }

    const refund = await stripe.refunds.create({
      charge: chargeId,
    });

    return {
      success: true,
      data: JSON.parse(JSON.stringify(refund)),
    };
  } catch (error: any) {
    console.error("Stripe Refund Error:", error);
    return { success: false, error: error.message };
  }
}

export async function getStripeAccount() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      throw new Error("Unauthorized");
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new Error("Stripe is not configured (Shopify checkout is active)");
    }

    const account = await stripe.accounts.retrieve();
    return {
      success: true,
      data: {
        id: account.id,
        email:
          account.email ||
          account.settings?.dashboard?.display_name ||
          "Stripe Managed",
        business_type: account.business_type,
      },
    };
  } catch (error: any) {
    console.error("Stripe Account Error:", error);
    return { success: false, error: error.message };
  }
}
