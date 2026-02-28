"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { toast } from "sonner";
import { ArrowRight, Mail, Lock, CheckCircle2, KeyRound } from "lucide-react";
import { requestPasswordReset, verifyOTP, resetPassword } from "@/actions/auth";
import Link from "next/link";
import SpinnerLoader from "@/components/common/SpinnerLoader";

import { useRouter } from "next/navigation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const savedEmail = sessionStorage.getItem("reset_email");
    if (savedEmail) setEmail(savedEmail);
  }, []);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await requestPasswordReset(email);
    if (result.success) {
      sessionStorage.setItem("reset_email", email);
      toast.success("Verification code sent to your email");
      router.push("/forgot-password/verify");
    } else {
      toast.error(result.error || "Failed to send code");
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <section className="pt-52 pb-20 px-6">
        <div className="max-w-md mx-auto">
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="text-center space-y-4">
              <h1 className="text-4xl font-serif tracking-widest uppercase">
                Recover Account
              </h1>
              <p className="text-sm text-muted-foreground font-sans">
                Enter your email address to receive a 6-digit verification code.
              </p>
            </div>

            <form onSubmit={handleSendOTP} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-60">
                  Email Address
                </label>
                <div className="relative group">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                    placeholder="Enter your email"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-5 bg-[#333] text-white uppercase tracking-[0.3em] text-[11px] font-bold hover:bg-black transition-all flex items-center justify-center gap-3 group"
              >
                {loading ? (
                  <SpinnerLoader className="w-5! h-5!" />
                ) : (
                  <>
                    Send Code{" "}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
                >
                  Return to Login
                </Link>
              </div>
            </form>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
