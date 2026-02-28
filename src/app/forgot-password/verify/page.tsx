"use client";

import React, { useState, useEffect } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { verifyOTP, requestPasswordReset } from "@/actions/auth";
import { useRouter } from "next/navigation";
import SpinnerLoader from "@/components/common/SpinnerLoader";

export default function VerifyOTPPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(0);
  const router = useRouter();

  // Reference for input fields to handle auto-focus
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const savedEmail = sessionStorage.getItem("reset_email");
    if (!savedEmail) {
      router.push("/forgot-password");
      return;
    }
    setEmail(savedEmail);

    // Load timer from localStorage if exists to persist across refreshes
    const savedTimer = localStorage.getItem("resend_timer");
    if (savedTimer) {
      const remaining = Math.max(
        0,
        Math.floor((parseInt(savedTimer) - Date.now()) / 1000),
      );
      if (remaining > 0) setTimer(remaining);
    }
  }, [router]);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1); // Only take last char
    if (!/^\d*$/.test(value)) return; // Only allow digits

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto focus next field
    if (value !== "" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && otp[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullOtp = otp.join("");
    if (fullOtp.length !== 6) {
      return toast.error("Please enter the 6-digit code");
    }
    setLoading(true);
    const result = await verifyOTP(email, fullOtp);
    if (result.success) {
      sessionStorage.setItem("reset_otp", fullOtp);
      router.push("/forgot-password/reset");
    } else {
      toast.error(result.error || "Invalid code");
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (timer > 0) return;
    setResending(true);
    const result = await requestPasswordReset(email);
    if (result.success) {
      toast.success("New verification code sent");
      const expiry = Date.now() + 120 * 1000; // 2 minutes
      setTimer(120);
      localStorage.setItem("resend_timer", expiry.toString());
    } else {
      toast.error(result.error || "Failed to resend code");
    }
    setResending(false);
  };

  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <section className="pt-52 pb-20 px-6">
        <div className="max-w-md mx-auto">
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="text-center space-y-4">
              <h1 className="text-4xl font-serif tracking-widest uppercase">
                Verify Identity
              </h1>
              <p className="text-sm text-muted-foreground font-sans">
                A verification code has been dispatched to{" "}
                <strong>{email}</strong>.
              </p>
            </div>

            <form onSubmit={handleVerifyOTP} className="space-y-10">
              <div className="flex justify-between gap-3">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    type="text"
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    value={digit}
                    maxLength={1}
                    autoFocus={index === 0}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className="w-14 h-20 text-center text-3xl font-serif bg-white transition-all shadow-sm"
                  />
                ))}
              </div>

              <div className="space-y-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-[#333] text-white uppercase tracking-[0.3em] text-[11px] font-bold hover:bg-black transition-all flex items-center justify-center shadow-lg shadow-black/5"
                >
                  {loading ? (
                    <SpinnerLoader className="w-5! h-5!" />
                  ) : (
                    "Authorize Session"
                  )}
                </button>

                <div className="text-center space-y-4">
                  <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">
                    Didn't receive the code?
                  </p>
                  <button
                    type="button"
                    disabled={timer > 0 || resending}
                    onClick={handleResend}
                    className={`text-[11px] uppercase tracking-widest font-bold border-b border-foreground/20 hover:border-foreground transition-all pb-1 ${
                      timer > 0
                        ? "opacity-20 cursor-not-allowed"
                        : "opacity-100"
                    }`}
                  >
                    {resending
                      ? "Sending..."
                      : timer > 0
                        ? `Resend in ${Math.floor(timer / 60)}:${(timer % 60)
                            .toString()
                            .padStart(2, "0")}`
                        : "Dispatch New Code"}
                  </button>
                </div>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => router.push("/forgot-password")}
                  className="text-[10px] uppercase tracking-widest font-bold opacity-30 hover:opacity-100 transition-opacity"
                >
                  Change Email Address
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
