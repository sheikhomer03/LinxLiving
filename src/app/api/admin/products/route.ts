import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50),
    );
    const skip = (page - 1) * limit;
    const search = String(searchParams.get("search") || "").trim();

    await connectDB();

    const filter: Record<string, unknown> = {};
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: escaped, $options: "i" };
      const tokens = escaped
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1);
      const tokenClauses = tokens.map((token) => ({
        $or: [
          { name: { $regex: token, $options: "i" } },
          { category: { $regex: token, $options: "i" } },
          { subCategory: { $regex: token, $options: "i" } },
          { sku: { $regex: token, $options: "i" } },
          { productCode: { $regex: token, $options: "i" } },
          { barcode: { $regex: token, $options: "i" } },
          { "specs.size": { $regex: token, $options: "i" } },
        ],
      }));
      filter.$or = [
        { name: rx },
        { category: rx },
        { subCategory: rx },
        { department: rx },
        { sku: rx },
        { productCode: rx },
        { barcode: rx },
        { "specs.size": rx },
        ...(tokenClauses.length > 1 ? [{ $and: tokenClauses }] : []),
      ];
    }

    // Use projection to only fetch fields needed for the table
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select("name price stock category subCategory images createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    return NextResponse.json(
      {
        success: true,
        products,
        pagination: {
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Fetch Products Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
