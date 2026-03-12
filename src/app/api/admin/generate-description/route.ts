import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, imageUrl } = await req.json();

    if (!name || !imageUrl) {
      return NextResponse.json(
        { error: "Product name and an image are required." },
        { status: 400 },
      );
    }

    const prompt = `You are an expert e-commerce copywriter.
Write an SEO-friendly, humanized, and highly conversion-focused product description for a product named "${name}".
Analyze the provided image of the product to include specific details about its design, material, finish, and style.
The description should be structured in 2-3 short, compelling paragraphs.
Do not include any placeholders or markdown headings, just return the raw text of the description itself.`;

    const chatCompletion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
      top_p: 1,
    });

    const description = chatCompletion.choices[0]?.message?.content || "";

    return NextResponse.json({ description: description.trim() });
  } catch (error: any) {
    console.error("Error generating product description:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate description" },
      { status: 500 },
    );
  }
}
