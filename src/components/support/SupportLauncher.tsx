"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MessageCircle,
  Phone,
  Mail,
  X,
  Send,
  User,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  onOpenSupportChat,
  type SupportChatContext,
} from "@/components/support/supportChatBus";
import { parseReply } from "@/lib/supportLinks";

/**
 * Floating help launcher, present on every page.
 *
 * Additive by design: it is fixed-position and rendered once in the root
 * layout, so no existing page, product flow or configurator changes.
 *
 * The assistant answers first. The "speak to the team" block is not permanent
 * furniture — it appears only on the turn where the customer asks for a
 * person, and clears again as soon as they carry on chatting.
 */

type Msg = { role: "user" | "assistant"; content: string };

export function SupportLauncher({
  phone,
  phoneHref,
  email,
  hours,
}: {
  phone: string;
  phoneHref: string;
  email: string;
  hours?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [handover, setHandover] = useState(false);
  const [context, setContext] = useState<SupportChatContext>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opened from a product page or Help Centre card.
  useEffect(
    () =>
      onOpenSupportChat((ctx) => {
        setContext(ctx);
        setOpen(true);
        if (ctx.topic) setInput(ctx.topic);
      }),
    [],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;

    setInput("");
    setHandover(false);
    setMessages((m) => [...m, { role: "user", content: question }]);
    setSending(true);
    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-6),
          context,
        }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply || "Sorry — something went wrong.",
        },
      ]);
      if (data.handover) setHandover(true);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "Sorry — I could not reach the assistant. Please send your question through our contact form and the team will reply.",
        },
      ]);
      setHandover(true);
    } finally {
      setSending(false);
    }
  };

  const contactHref = context.productName
    ? `/contact?product=${encodeURIComponent(context.productName)}`
    : "/contact";

  // Carry the question across so the customer does not retype it.
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user");
  const handoverMailto = `mailto:${email}?subject=${encodeURIComponent(
    context.productName
      ? `Support request — ${context.productName}`
      : "Support request",
  )}&body=${encodeURIComponent(
    [
      "Hello,",
      "",
      context.productName ? `Product: ${context.productName}` : "",
      lastQuestion ? `My question: ${lastQuestion.content}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )}`;

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close help" : "Need help? Chat with our team"}
        className={cn(
          // Pill when closed, perfect circle once open — the square-cornered
          // block read as an unstyled dev button.
          "fixed bottom-6 right-6 z-[60] inline-flex items-center justify-center rounded-full",
          "bg-[#D3102F] text-white ring-1 ring-black/10",
          "shadow-[0_8px_24px_rgba(211,16,47,0.35)]",
          "transition-all duration-300 ease-out",
          "hover:bg-[#b60d28] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(211,16,47,0.45)]",
          "active:translate-y-0 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#D3102F]",
          open ? "h-14 w-14" : "h-14 gap-2.5 pl-5 pr-6",
        )}
      >
        {open ? (
          <X className="w-5 h-5" />
        ) : (
          <>
            <MessageCircle className="w-5 h-5 shrink-0" />
            <span className="text-[12px] font-bold uppercase tracking-[0.14em] whitespace-nowrap">
              Need help?
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-[60] w-[min(380px,calc(100vw-3rem))] bg-white border border-foreground/10 rounded-2xl overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.18)] flex flex-col max-h-[min(600px,calc(100vh-8rem))]">
          <div className="bg-[#D3102F] text-white px-5 py-4">
            <p className="text-sm font-bold">
              Need help choosing the right product?
            </p>
            <p className="text-[12px] text-white/85 mt-0.5">
              Chat with our team{hours ? ` · ${hours}` : ""}
            </p>
          </div>

          {/* Always-available human routes, never hidden behind the assistant */}
          <div className="grid grid-cols-2 gap-px bg-foreground/10 border-b border-foreground/10">
            <a
              href={phoneHref || undefined}
              className="bg-white px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-secondary transition-colors"
            >
              <Phone className="w-3.5 h-3.5 inline-block mr-1.5" />
              {phone}
            </a>
            <a
              href={`mailto:${email}`}
              className="bg-white px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-secondary transition-colors"
            >
              <Mail className="w-3.5 h-3.5 inline-block mr-1.5" />
              Email us
            </a>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 ? (
              <div className="text-[13px] text-foreground/70 leading-relaxed">
                <p>Ask us about:</p>
                <ul className="mt-2 space-y-1">
                  {[
                    "Measurements and quantities",
                    "Delivery times",
                    "Samples and stock",
                    "Orders and returns",
                  ].map((t) => (
                    <li key={t}>
                      <button
                        type="button"
                        onClick={() => send(t)}
                        className="text-left underline underline-offset-4 hover:text-foreground"
                      >
                        {t}
                      </button>
                    </li>
                  ))}
                </ul>
                {context.productName ? (
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    About: {context.productName}
                  </p>
                ) : null}
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "text-[13px] leading-relaxed px-3 py-2 max-w-[85%] whitespace-pre-wrap",
                    m.role === "user"
                      ? "ml-auto bg-foreground text-background"
                      : "bg-secondary text-foreground",
                  )}
                >
                  {m.role === "assistant"
                    ? parseReply(m.content).map((part, j) =>
                        part.type === "link" ? (
                          <Link
                            key={j}
                            href={part.href}
                            onClick={() => setOpen(false)}
                            className="font-semibold underline underline-offset-2 hover:text-[#D3102F]"
                          >
                            {part.text}
                          </Link>
                        ) : (
                          <span key={j}>{part.text}</span>
                        ),
                      )
                    : m.content}
                </div>
              ))
            )}

            {sending ? (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking…
              </div>
            ) : null}

            {handover ? (
              <div className="border border-foreground/15 p-3">
                <div className="flex flex-col gap-2">
                  <Link
                    href={contactHref}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-foreground text-background text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-foreground/85"
                  >
                    <User className="w-3.5 h-3.5" />
                    Message a live agent
                  </Link>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={phoneHref || undefined}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-foreground/20 text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-secondary"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      Call
                    </a>
                    <a
                      href={handoverMailto}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-foreground/20 text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-secondary"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email
                    </a>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="border-t border-foreground/10 p-3 flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 px-3 py-2.5 text-[13px] border border-foreground/15 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="px-3 py-2.5 bg-[#D3102F] text-white disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          <p className="px-3 pb-3 text-[10px] text-muted-foreground">
            Automated assistant. Ask for a person at any time and we will point
            you to the{" "}
            <Link href="/contact" className="underline underline-offset-2">
              contact form
            </Link>
            .
          </p>
        </div>
      )}
    </>
  );
}
