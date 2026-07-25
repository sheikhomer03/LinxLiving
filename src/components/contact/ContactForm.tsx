"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { submitInquiry } from "@/app/actions/contact";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const contactSchema = z.object({
  name: z.string().min(2, "Please enter your name"),
  email: z.string().email("Please enter a valid email"),
  subject: z.string().min(3, "Please add a subject"),
  message: z.string().min(10, "Please write a short message"),
});

type ContactFormData = z.infer<typeof contactSchema>;

const fieldClass =
  "w-full pl-4 pr-4 py-4 bg-secondary/50 text-sm outline-none transition-all focus:bg-white border border-transparent focus:border-primary/25 disabled:opacity-60";

export function ContactForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => formData.append(key, value));

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
