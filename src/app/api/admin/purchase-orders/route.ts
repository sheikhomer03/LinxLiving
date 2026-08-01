import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getPurchaseOrders,
  createPurchaseOrdersFromOrder,
} from "@/app/actions/purchaseOrders";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await getPurchaseOrders();
  return NextResponse.json(res);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  if (!body?.orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }
  const res = await createPurchaseOrdersFromOrder(String(body.orderId));
  return NextResponse.json(res, { status: res.success ? 201 : 400 });
}
