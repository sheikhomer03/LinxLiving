"use client";

import { useState } from "react";
import { subscribeToNewsletter } from "@/app/actions/newsletter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);

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
    } catch (error) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex  flex-col sm:flex-row gap-4 mt-8"
    >
      <input
        type="email"
        placeholder="EMAIL ADDRESS"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isPending}
        className="flex-1 input-standard bg-transparent border-b border-foreground/20 py-4 px-2 text-xs tracking-widest focus:border-foreground outline-none transition-colors uppercase disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isPending}
        className="px-10 input-standard py-4 bg-foreground text-background uppercase tracking-widest text-[10px] font-bold hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {isPending ? "Subscribing..." : "Subscribe"}
      </button>
    </form>
  );
}
