"use client";

import { useState } from "react";
import { submitInquiry } from "@/app/actions/contact";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function ContactForm() {
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsPending(true);

    const formData = new FormData(e.currentTarget);

    try {
      const result = await submitInquiry(formData);
      if (result.success) {
        toast.success(result.message);
        (e.target as HTMLFormElement).reset();
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
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Full Name
        </label>
        <div className="input-standard">
          <input
            name="name"
            type="text"
            required
            placeholder="Enter your name"
            disabled={isPending}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm disabled:opacity-50"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Email Address
        </label>
        <div className="input-standard">
          <input
            name="email"
            type="email"
            required
            placeholder="Enter your email"
            disabled={isPending}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm disabled:opacity-50"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Subject
        </label>
        <div className="input-standard">
          <input
            name="subject"
            type="text"
            required
            placeholder="What can we help you with?"
            disabled={isPending}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm disabled:opacity-50"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Message
        </label>
        <div className="input-standard">
          <textarea
            name="message"
            required
            rows={4}
            placeholder="Write your message here..."
            disabled={isPending}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm shadow-sm resize-none disabled:opacity-50"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-[#333] text-white py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {isPending ? "Submitting..." : "Submit Inquiry"}
      </button>
    </form>
  );
}
