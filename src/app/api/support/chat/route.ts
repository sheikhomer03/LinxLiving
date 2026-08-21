import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { matchCannedAnswer, DELIVERY_POLICY_LINE } from "@/lib/supportAnswers";
import { linkifyReply } from "@/lib/supportLinks";

/**
 * Support chat assistant.
 *
 * Two tiers, cheapest first:
 *
 *  1. Pre-defined answers (`@/lib/supportAnswers`) handle the questions that
 *     make up most of the traffic — delivery, returns, samples, tracking,
 *     measuring, trade accounts. Free, instant, and worded exactly as the
 *     policy pages are.
 *  2. Anything the canned list does not cover goes to Claude, which answers
 *     only from real catalogue and policy data supplied below.
 *
 * The model is explicitly not allowed to invent prices, stock levels or
 * delivery dates.
 *
 * The bot always answers first. `handover: true` is returned only when the
 * customer has actually asked for a person — not merely because the bot was
 * unsure — and it points them at the contact form, so the team gets their
 * details and can reply properly.
 */

export const runtime = "nodejs";

/** Offered when the assistant genuinely cannot answer — an invitation, not a
    hand-off. The customer still has to accept it. */
const OFFER_LINE =
  "Would you like to speak to a member of the LINX Square team?";

/** Small and fast — this is short-answer retail Q&A, not deep reasoning. */
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/** Policy answers the assistant may quote verbatim. */
const POLICY_CONTEXT = `
DELIVERY: ${DELIVERY_POLICY_LINE} Orders can be tracked on the
[Track your order](/track-order) page using the order number and email
address.

SAMPLES: Free samples can be ordered from any product page using the
"Order a free sample" button. Samples are a request, not a purchase — no
payment is taken and nothing is added to the basket.

RETURNS AND REFUNDS: The current policy is on the
[Delivery & Returns](/shipping-returns) page.

TRADE ACCOUNTS: Trade pricing is available across every range. Customers
apply through the [contact form](/contact).

MEASURING: Tile and flooring products are sold by the square metre. Each
product page has a calculator: enter the area required, add the standard 10%
wastage allowance, and it rounds up to whole packs or boxes.

MADE TO MEASURE: Windows, doors, pergolas, awnings and front doors are not
sold directly online. The customer submits an enquiry and the team calls to
take sizes and price it.

PRICE ON REQUEST: Some products show "Request a quote" instead of a price.
Those are quoted by the team — submit the enquiry and they will respond.
`.trim();

/** Products matching the question, so answers cite real catalogue data. */
async function findRelevantProducts(question: string) {
  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 6);
  if (!terms.length) return [];

  await connectDB();
  const rx = new RegExp(
    terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "i",
  );

  const rows = await Product.find({
    $or: [{ name: rx }, { category: rx }, { subCategory: rx }],
    price: { $gt: 0 },
    category: { $exists: true, $nin: [null, ""] },
  })
    .select("name price stock category specs")
    .limit(6)
    .lean();

  return rows.map((p: any) => ({
    name: p.name,
    price: p.price,
    inStock: (p.stock ?? 0) > 0,
    category: p.category,
    size: p.specs?.size || p.specs?.Size || "",
    unit: p.specs?.priceUnit || p.specs?.unit || "",
  }));
}

function buildSystemPrompt(
  products: Awaited<ReturnType<typeof findRelevantProducts>>,
  productName?: string,
) {
  return `You are the customer support assistant for LINX Square, a UK trade
supplier of tiles, flooring, bathrooms, heating and roof windows.

Answer ONLY from the CONTEXT below. Follow these rules exactly:
- Never invent prices, stock levels, delivery dates or product specifications.
- If the context does not contain the answer, do not guess. Reply with a short
  apology and exactly this sentence: "${OFFER_LINE}"
- Keep answers under 80 words, plain and practical. British English.
- Write like a helpful shop assistant, not a website. NEVER put a raw URL or
  path in your reply. Do not write "/shipping-returns" or "see /contact".
- To point at a page, use a named markdown link and nothing else, exactly like
  these: [Track your order](/track-order), [Delivery & Returns](/shipping-returns),
  [contact form](/contact), [Help Centre](/help), [FAQs](/faq).
- Never promise a refund, discount or delivery date.
- Do not apologise more than once, and never start with "I apologize".

CONTEXT — POLICIES:
${POLICY_CONTEXT}

CONTEXT — MATCHING PRODUCTS:
${products.length ? JSON.stringify(products, null, 2) : "No matching products found."}

${productName ? `The customer is viewing: ${productName}` : ""}`;
}

type Turn = { role: "user" | "assistant"; content: string };

/** Straightforward "put me through to a person" phrasing. */
const AGENT_REQUEST =
  /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|someone|agent|advisor|adviser|representative|rep|member|staff|team)\b|\b(human|live)\s+(agent|person|support)\b|\breal person\b|\bcustomer service\b|\bput me through\b/i;

/** "yes", "please do", "go on" — only meaningful right after an offer. */
const AFFIRMATIVE = /^(yes|yeah|yep|yh|ok|okay|sure|please|yes please|go on|do that|sounds good|alright)\b/i;

/**
 * True only when the customer has actually asked for a person.
 *
 * The bot answers first, every time. A hedge ("I'm not sure") is not a
 * hand-off — it is an offer the customer can accept or ignore, which is why
 * an affirmative only counts when the previous turn actually made one.
 */
function wantsAgent(question: string, prior: Turn[]): boolean {
  if (AGENT_REQUEST.test(question)) return true;

  const lastAssistant = [...prior].reverse().find((t) => t.role === "assistant");
  return Boolean(
    lastAssistant?.content.includes(OFFER_LINE) && AFFIRMATIVE.test(question.trim()),
  );
}

/** Claude first; Groq only if no Anthropic key is configured. */
async function askModel(
  system: string,
  history: Turn[],
  question: string,
): Promise<string | null> {
  const messages: Turn[] = [...history, { role: "user", content: question }];

  if (process.env.ANTHROPIC_API_KEY) {
    console.log("[support chat] answering with Claude");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      temperature: 0.2,
      system,
      messages,
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  }

  if (process.env.GROQ_API_KEY) {
    console.log("[support chat] no Anthropic key — falling back to Groq");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_tokens: 300,
      messages: [{ role: "system", content: system }, ...messages],
    });
    return completion.choices?.[0]?.message?.content?.trim() || null;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    // Same protection the contact form uses.
    const ip = await getClientIp();
    const limit = checkRateLimit(`support-chat:${ip}`, 20, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({
        reply:
          "Sorry — too many messages just now. Please send your question through our contact form and the team will reply.",
        handover: true,
      });
    }

    const { message, history = [], context } = await request.json();
    const question = String(message || "").trim();
    if (!question) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }
    if (question.length > 1000) {
      return NextResponse.json({
        reply:
          "That is a little long for chat — please send it through our contact form so the team can read it properly.",
        handover: true,
      });
    }

    const prior = (Array.isArray(history) ? history : []).slice(-6) as Turn[];

    // Tier 1 — pre-defined answer. Costs nothing and is always on-policy.
    // Skipped mid-conversation, where a one-word reply ("and the cost?")
    // only makes sense against what was said before.
    const askedForAgent = wantsAgent(question, prior);

    if (prior.length === 0 || askedForAgent) {
      const canned = matchCannedAnswer(question);
      if (canned) {
        return NextResponse.json({
          reply: canned.answer,
          handover: canned.id === "contact" || askedForAgent,
          source: "predefined",
        });
      }
    }

    // Asked for a person but phrased in a way the canned list missed.
    if (askedForAgent) {
      return NextResponse.json({
        reply:
          "Of course. Send your question through our contact form and a member of the team will get back to you — that way they have your details and can reply properly.",
        handover: true,
        source: "predefined",
      });
    }

    // Tier 2 — the model, for anything the canned list does not cover.
    if (!process.env.ANTHROPIC_API_KEY && !process.env.GROQ_API_KEY) {
      // No assistant configured — hand straight to a person rather than fail.
      return NextResponse.json({
        reply:
          "I cannot answer that one myself. Send it through our contact form and a member of the team will reply.",
        handover: true,
      });
    }

    const products = await findRelevantProducts(question);
    const system = buildSystemPrompt(products, context?.productName);
    // Safety net: if the model slips and emits a bare path anyway, rewrite it
    // into a named link before the customer ever sees it.
    const reply = linkifyReply(
      (await askModel(system, prior, question)) ||
        `I am not sure about that one. ${OFFER_LINE}`,
    );

    // The bot hedging is not a hand-off — it only offers. The customer has to
    // accept before the contact-form block appears.
    return NextResponse.json({ reply, handover: false, source: "ai" });
  } catch (error) {
    console.error("support chat:", error);
    return NextResponse.json({
      reply:
        "Sorry — I could not answer that. Please send it through our contact form and the team will reply.",
      handover: true,
    });
  }
}
