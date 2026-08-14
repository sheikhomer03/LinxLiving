"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { submitInquiry } from "@/app/actions/contact";
import { toast } from "sonner";
import { ChevronDown, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LINX Square Distribution's own enquiry form.
 *
 * Deliberately does not redirect to the general /contact page — a wholesale
 * buyer's questions (business type, order quantity, tile requirement) are
 * different from a retail customer's, so this form asks for them directly.
 * The backend is the same proven `submitInquiry` action /contact already
 * uses (rate limiting, honeypot, admin notification, Shopify sync) — no new
 * model or endpoint, just distribution-specific fields packed into the
 * subject/message it already accepts.
 */

const BUSINESS_TYPES = [
  "Tile retailer",
  "Builders' merchant",
  "Flooring and tile company",
  "Property developer",
  "Housebuilder",
  "Contractor",
  "Architect or designer",
  "Hotel or commercial development",
  "Distributor or wholesaler",
  "Other",
] as const;

const distributionSchema = z.object({
  name: z.string().min(2, "Please enter your name"),
  company: z.string().min(2, "Please enter your company name"),
  email: z.string().email("Please enter a valid email"),
  phone: z.string().min(6, "Please enter a phone number"),
  businessType: z.string().min(1, "Please select your business type"),
  quantity: z.string().optional(),
  message: z.string().min(10, "Please tell us a little about your requirement"),
  consent: z.literal(true, {
    message: "Please agree so we can reply to you",
  }),
  // Honeypot — hidden from real users, bots fill it in.
  website: z.string().optional(),
});

type DistributionFormData = z.infer<typeof distributionSchema>;

const fieldClass =
  // Explicit text-foreground (not inherited) — this form sits on a white
  // card inside a dark (text-white) section, so without this every field's
  // typed text would inherit white-on-white and be invisible.
  "w-full pl-4 pr-4 py-4 bg-secondary/50 text-sm text-foreground placeholder:text-foreground/40 outline-none transition-all focus:bg-white border border-foreground/45 hover:border-foreground/65 focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-60";

export function DistributionEnquiryForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DistributionFormData>({
    resolver: zodResolver(distributionSchema),
    defaultValues: {
      name: "",
      company: "",
      email: "",
      phone: "",
      businessType: "",
      quantity: "",
      message: "",
      website: "",
    },
  });

  const onSubmit = async (data: DistributionFormData) => {
    const formData = new FormData();
    formData.append("name", data.name);
    formData.append("email", data.email);
    formData.append("phone", data.phone ?? "");
    formData.append("company", data.company);
    formData.append("website", data.website ?? "");
    formData.append("consent", "on");
    formData.append("subject", `Distribution enquiry — ${data.businessType}`);
    formData.append(
      "message",
      [
        `Business type: ${data.businessType}`,
        `Estimated order quantity: ${data.quantity?.trim() || "Not specified"}`,
        "",
        data.message,
      ].join("\n"),
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
            Company name
          </label>
          <input
            {...register("company")}
            type="text"
            placeholder="Your business name"
            disabled={isSubmitting}
            autoComplete="organization"
            className={cn(fieldClass, errors.company && "border-red-500/60")}
          />
          {errors.company && (
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
              {errors.company.message}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Email address
          </label>
          <input
            {...register("email")}
            type="email"
            placeholder="you@company.com"
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

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Phone
          </label>
          <input
            {...register("phone")}
            type="tel"
            placeholder="For a callback"
            disabled={isSubmitting}
            autoComplete="tel"
            className={cn(fieldClass, errors.phone && "border-red-500/60")}
          />
          {errors.phone && (
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
              {errors.phone.message}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Business type
          </label>
          <div className="relative">
            <select
              {...register("businessType")}
              disabled={isSubmitting}
              defaultValue=""
              className={cn(
                fieldClass,
                "appearance-none pr-10",
                errors.businessType && "border-red-500/60",
              )}
            >
              <option value="" disabled>
                Select your business type
              </option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-foreground opacity-60" />
          </div>
          {errors.businessType && (
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
              {errors.businessType.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-foreground/55">
            Estimated order quantity{" "}
            <span className="opacity-50">(optional)</span>
          </label>
          <input
            {...register("quantity")}
            type="text"
            placeholder="e.g. 10,000 m²"
            disabled={isSubmitting}
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
          Tile requirement
        </label>
        <textarea
          {...register("message")}
          rows={5}
          placeholder="Size, finish, colour, design — and anything else about your project or resale range…"
          disabled={isSubmitting}
          className={cn(
            fieldClass,
            "resize-none min-h-35",
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
            I agree to LINX Square storing the details above so they can
            respond to my enquiry. See our{" "}
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
            Send enquiry
          </>
        )}
      </button>
    </form>
  );
}
