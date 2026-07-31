import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Supplier } from "@/models/Supplier";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/** Secure admin REST: list / create suppliers for integrations. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectDB();
    const suppliers = await Supplier.find()
      .sort({ order: 1, name: 1 })
      .lean();
    return NextResponse.json({ success: true, suppliers });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    if (!body?.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await connectDB();
    const slug =
      String(body.slug || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") ||
      String(body.name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-");

    const supplier = await Supplier.create({
      name: body.name,
      slug,
      email: body.email || "",
      phone: body.phone || "",
      website: body.website || "",
      integrationType: body.integrationType || "manual",
      apiEndpoint: body.apiEndpoint || "",
      feedUrl: body.feedUrl || "",
      defaultMarginPercent: body.defaultMarginPercent ?? 35,
      priority: body.priority ?? 100,
      country: body.country || "GB",
      currency: body.currency || "GBP",
      isImport: !!body.isImport,
      isActive: body.isActive !== false,
    });

    return NextResponse.json({ success: true, supplier }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
