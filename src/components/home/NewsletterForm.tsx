"use client";

import { useState } from "react";
import { subscribeToNewsletter } from "@/app/actions/newsletter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewsletterFormProps {
  variant?: "default" | "footer";
}

export function NewsletterForm({ variant = "default" }: NewsletterFormProps) {
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const isFooter = variant === "footer";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsPending(true);
    const formData = new FormData();
    formData.append("email", email);

    try {
      const result = await subscribeToNewsletter(formData);
      if (result.success) {
        toast.success(result.message);
        setEmail("");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex flex-col gap-3",
        !isFooter && "sm:flex-row gap-4 mt-8",
      )}
    >
      <input
        type="email"
        placeholder="EMAIL ADDRESS"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isPending}
        className={cn(
          "flex-1 py-3 px-3 text-xs tracking-widest outline-none transition-colors uppercase disabled:opacity-80",
          isFooter
            ? "!border !border-solid !border-white/35 bg-white/5 text-white placeholder:text-white/45 focus:!border-primary focus:bg-white/10"
            : "input-standard bg-transparent !border-0 !border-b !border-solid !border-foreground/20 py-4 focus:!border-foreground",
        )}
      />
      <button
        type="submit"
        disabled={isPending}
        className={cn(
          "uppercase tracking-widest text-[10px] font-bold transition-colors disabled:opacity-80 flex items-center justify-center gap-2",
          isFooter
            ? "w-full px-6 py-3 bg-white text-black hover:bg-primary hover:text-primary-foreground"
            : "px-10 input-standard py-4 bg-foreground text-background hover:bg-accent hover:text-foreground",
        )}
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {isPending ? "Subscribing..." : "Subscribe"}
      </button>
    </form>
  );
}
