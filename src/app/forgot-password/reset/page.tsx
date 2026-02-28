"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { resetPassword } from "@/actions/auth";
import { useRouter } from "next/navigation";
import SpinnerLoader from "@/components/common/SpinnerLoader";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const savedEmail = sessionStorage.getItem("reset_email");
    const savedOtp = sessionStorage.getItem("reset_otp");

    if (!savedEmail || !savedOtp) {
      router.push("/forgot-password");
      return;
    }

    setEmail(savedEmail);
    setOtp(savedOtp);
  }, [router]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return toast.error("Passwords do not match");
    }
    if (newPassword.length < 8) {
      return toast.error("Password must be at least 8 characters");
    }
    setLoading(true);
    const result = await resetPassword({ email, otp, password: newPassword });
    if (result.success) {
      sessionStorage.removeItem("reset_email");
      sessionStorage.removeItem("reset_otp");
      router.push("/forgot-password/success");
      toast.success("Password reset successfully");
    } else {
      toast.error(result.error || "Failed to reset password");
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
                New Credentials
              </h1>
              <p className="text-sm text-muted-foreground font-sans">
                Identity verified. Please establish a new secure entry code.
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-6">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-60">
                    New Password
                  </label>
                  <div className="relative group">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-60">
                    Confirm New Password
                  </label>
                  <div className="relative group">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-5 bg-[#333] text-white uppercase tracking-[0.3em] text-[11px] font-bold hover:bg-black transition-all flex items-center justify-center"
              >
                {loading ? (
                  <SpinnerLoader className="w-5! h-5!" />
                ) : (
                  "Update Credentials"
                )}
              </button>
            </form>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
