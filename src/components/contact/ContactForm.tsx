"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { submitInquiry } from "@/app/actions/contact";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";

const contactSchema = z.object({
  name: z.string().min(2, "Please enter your name"),
  email: z.string().email("Please enter a valid email"),
  phone: z.string().optional(),
  company: z.string().optional(),
  subject: z.string().min(3, "Please add a subject"),
  message: z.string().min(10, "Please write a short message"),
  consent: z.literal(true, {
    message: "Please agree so we can reply to you",
  }),
  // Honeypot — hidden from real users, bots fill it in.
  website: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

const fieldClass =
  "w-full pl-4 pr-4 py-4 bg-secondary/50 text-sm outline-none transition-all focus:bg-white border border-transparent focus:border-primary/25 disabled:opacity-60";

export function ContactForm() {
  // Arriving from an unpriced product ("Request a quote") — pre-fill the
  // subject and message with what they were looking at, so neither the
  // customer nor the sales team has to retype it.
  const searchParams = useSearchParams();
  const productName = searchParams.get("product")?.trim() || "";
  const productRef = searchParams.get("ref")?.trim() || "";
  const productBrand = searchParams.get("brand")?.trim() || "";

  const prefill = productName
    ? {
        subject: `Price request — ${productName}`,
        message: [
          `Please send me a price for:`,
          ``,
          `Product: ${productName}`,
          productBrand ? `Brand: ${productBrand}` : null,
          productRef ? `Ref: ${productRef}` : null,
          ``,
          `Quantity needed: `,
        ]
          .filter((l) => l !== null)
          .join("\n"),
      }
    : null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: prefill
      ? { subject: prefill.subject, message: prefill.message }
      : undefined,
  });

  const onSubmit = async (data: ContactFormData) => {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) =>
      formData.append(key, String(value ?? "")),
    );

    try {
      const result = await submitInquiry(formData);
      if (result.success) {
        toast.success(result.message);
        reset();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Full name
          </label>
          <input
            {...register("name")}
            type="text"
            placeholder="Your name"
            disabled={isSubmitting}
            autoComplete="name"
            className={cn(fieldClass, errors.name && "border-red-500/60")}
          />
          {errors.name && (
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Email address
          </label>
          <input
            {...register("email")}
            type="email"
            placeholder="you@example.com"
            disabled={isSubmitting}
            autoComplete="email"
            className={cn(fieldClass, errors.email && "border-red-500/60")}
          />
          {errors.email && (
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
              {errors.email.message}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Phone <span className="opacity-50">(optional)</span>
          </label>
          <input
            {...register("phone")}
            type="tel"
            placeholder="For a callback"
            disabled={isSubmitting}
            autoComplete="tel"
            className={fieldClass}
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Company <span className="opacity-50">(optional)</span>
          </label>
          <input
            {...register("company")}
            type="text"
            placeholder="Trade account or business name"
            disabled={isSubmitting}
            autoComplete="organization"
            className={fieldClass}
          />
        </div>
      </div>

      {/* Honeypot — visually hidden, never shown to real users */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input {...register("website")} type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
          Subject
        </label>
        <input
          {...register("subject")}
          type="text"
          placeholder="Samples, specification, project advice…"
          disabled={isSubmitting}
          className={cn(fieldClass, errors.subject && "border-red-500/60")}
        />
        {errors.subject && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.subject.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
          Message
        </label>
        <textarea
          {...register("message")}
          rows={5}
          placeholder="Tell us about your space, materials, or timeline…"
          disabled={isSubmitting}
          className={cn(
            fieldClass,
            "resize-none min-h-[140px]",
            errors.message && "border-red-500/60",
          )}
        />
        {errors.message && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.message.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            {...register("consent")}
            type="checkbox"
            disabled={isSubmitting}
            className="mt-0.5 w-4 h-4 accent-primary shrink-0 cursor-pointer"
          />
          <span className="text-[11px] leading-relaxed text-foreground/70">
            I agree to LINX Square storing the details above so they can respond
            to my enquiry. See our{" "}
            <a href="/privacy" className="underline hover:text-foreground">
              privacy policy
            </a>
            .
          </span>
        </label>
        {errors.consent && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.consent.message}
          </p>
        )}
      </div>

      <p className="text-[11px] text-foreground/55 leading-relaxed">
        We aim to reply to all enquiries within 1 working day.
      </p>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full inline-flex items-center justify-center gap-3 px-12 py-5 bg-primary text-primary-foreground uppercase tracking-[0.25em] text-[10px] font-bold hover:bg-black hover:text-white transition-all disabled:opacity-60"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Send inquiry
          </>
        )}
      </button>
    </form>
  );
}
