"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { submitInquiry } from "@/app/actions/contact";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const contactSchema = z.object({
  name: z.string().min(2, "NAME IS TOO SHORT"),
  email: z.string().email("INVALID EMAIL FORMAT"),
  subject: z.string().min(3, "SUBJECT IS TOO SHORT"),
  message: z.string().min(10, "MESSAGE IS TOO SHORT"),
});

type ContactFormData = z.infer<typeof contactSchema>;

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
    } catch (error) {
      toast.error("Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Full Name
        </label>
        <div
          className={`input-standard ${errors.name ? "border-red-500!" : ""}`}
        >
          <input
            {...register("name")}
            type="text"
            placeholder="Enter your name"
            disabled={isSubmitting}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm disabled:opacity-50"
          />
        </div>
        {errors.name && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Email Address
        </label>
        <div
          className={`input-standard ${errors.email ? "border-red-500!" : ""}`}
        >
          <input
            {...register("email")}
            type="email"
            placeholder="Enter your email"
            disabled={isSubmitting}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm disabled:opacity-50"
          />
        </div>
        {errors.email && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Subject
        </label>
        <div
          className={`input-standard ${errors.subject ? "border-red-500!" : ""}`}
        >
          <input
            {...register("subject")}
            type="text"
            placeholder="What can we help you with?"
            disabled={isSubmitting}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm disabled:opacity-50"
          />
        </div>
        {errors.subject && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.subject.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          Message
        </label>
        <div
          className={`input-standard ${errors.message ? "border-red-500!" : ""}`}
        >
          <textarea
            {...register("message")}
            rows={4}
            placeholder="Write your message here..."
            disabled={isSubmitting}
            className="w-full bg-white py-3 px-4 outline-none transition-all text-sm shadow-sm resize-none disabled:opacity-50"
          />
        </div>
        {errors.message && (
          <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
            {errors.message.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-[#333] text-white py-5 uppercase tracking-widest text-[10px] font-bold hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {isSubmitting ? "Submitting..." : "Submit Inquiry"}
      </button>
    </form>
  );
}
