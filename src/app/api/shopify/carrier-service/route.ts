/**
 * Shopify carrier-service callback: the delivery rate for a live basket.
 *
 * Shopify's own rates are flat per zone, and the Linx rule is not — it depends
 * on what is in the basket (Flooring and Tiles ship on a pallet at £60, other
 * goods at £100) and on the goods total (free at £300). Encoding that as fixed
 * Shopify rates is not possible: a two-profile split charges £60 + £100 on a
 * mixed basket, which is neither of the two answers. A carrier service is the
 * one mechanism that lets Shopify ask the question at checkout time.
 *
 * Shopify POSTs the basket here and takes the returned rate as the truth, so
 * this endpoint and the on-site basket both read `lib/shipping` — the figure
 * quoted in the cart is then the figure charged at checkout by construction.
 *
 * Shopify sends no signature with a carrier-service request, so the shared
 * secret lives in the path (`?token=`), set as SHOPIFY_CARRIER_SERVICE_TOKEN.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import {
  STANDARD_DELIVERY,
  shippingCostFor,
  type ShippableItem,
} from "@/lib/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shopify quotes money in minor units; the Linx rules are stated in pounds. */
const toPence = (pounds: number) => Math.round(pounds * 100);
const toPounds = (pence: number) => pence / 100;

type CarrierItem = {
  name?: string;
  sku?: string | null;
  quantity?: number;
  price?: number;
  product_id?: number | string | null;
  variant_id?: number | string | null;
};

type CarrierRequest = {
  rate?: {
    items?: CarrierItem[];
    currency?: string;
    destination?: { country?: string };
  };
};

function workingDaysFromNow(days: number) {
  const date = new Date();
  let left = days;
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date.toISOString().replace(/\.\d{3}Z$/, " +0000");
}

/**
 * Department per basket line.
 *
 * Shopify identifies a line by its numeric product id; Mongo stores the GID.
 * One query covers the whole basket — a checkout must not become a query per
 * line, and Shopify abandons the request after a few seconds.
 */
async function departmentsFor(items: CarrierItem[]): Promise<ShippableItem[]> {
  const gids = [
    ...new Set(
      items
        .map((i) => (i.product_id == null ? "" : `gid://shopify/Product/${i.product_id}`))
        .filter(Boolean),
    ),
  ];
  if (!gids.length) return [];

  await connectDB();
  const rows = await Product.find({ shopifyProductId: { $in: gids } })
    .select("shopifyProductId department category")
    .lean();

  const byGid = new Map(
    (rows as { shopifyProductId?: string; department?: string; category?: string }[]).map(
      (r) => [String(r.shopifyProductId), r],
    ),
  );

  return items.map((i) => {
    const row = byGid.get(`gid://shopify/Product/${i.product_id}`);
    return { department: row?.department ?? null, category: row?.category ?? null };
  });
}

export async function POST(req: Request) {
  const expected = process.env.SHOPIFY_CARRIER_SERVICE_TOKEN?.trim();
  const supplied = new URL(req.url).searchParams.get("token")?.trim();
  if (expected && supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CarrierRequest;
  try {
    body = (await req.json()) as CarrierRequest;
  } catch {
    return NextResponse.json({ rates: [] }, { status: 200 });
  }

  const items = body.rate?.items ?? [];
  const currency = body.rate?.currency || "GBP";

  // Goods total as Shopify sees it, in pounds, so the £300 threshold means the
  // same thing here as it does in the basket.
  const subtotal = toPounds(
    items.reduce(
      (sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 1),
      0,
    ),
  );

  let lines: ShippableItem[] = [];
  try {
    lines = await departmentsFor(items);
  } catch (error) {
    // A rate must still be returned: answering with nothing makes Shopify show
    // "no shipping available" and the customer cannot check out at all. The
    // standard rate is the safe side of that trade — it never under-charges.
    console.error("carrier-service lookup failed:", error);
    lines = [];
  }

  const cost = shippingCostFor(lines, subtotal);

  return NextResponse.json({
    rates: [
      {
        service_name: STANDARD_DELIVERY.method,
        service_code: "LINX_STANDARD",
        total_price: String(toPence(cost)),
        currency,
        description: cost === 0 ? "Free delivery" : STANDARD_DELIVERY.blurb,
        min_delivery_date: workingDaysFromNow(
          Math.max(1, STANDARD_DELIVERY.leadTimeDays - 5),
        ),
        max_delivery_date: workingDaysFromNow(STANDARD_DELIVERY.leadTimeDays),
      },
    ],
  });
}

/** Shopify probes the callback with a GET when the service is registered. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "linx-carrier-service" });
}
