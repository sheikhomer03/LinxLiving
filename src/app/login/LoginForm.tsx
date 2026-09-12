"use client";

import React, { useState, useEffect } from "react";
import { Footer } from "@/components/layout/Footer";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Mail, Lock, Eye, EyeOff } from "lucide-react";
import SpinnerLoader from "@/components/common/SpinnerLoader";
import LoginSuccessLoader from "@/components/common/LoginSuccessLoader";
import { getStoreName } from "@/app/actions/settings";

export function LoginForm({ navbar }: { navbar: React.ReactNode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSuccessLoader, setShowSuccessLoader] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [storeName, setStoreName] = useState("Linx Square");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  /*
   * Warm the two places a sign-in can land.
   *
   * Navigation used to start only after the success splash finished, so the
   * route's bundle and its RSC payload were fetched with the customer already
   * staring at a screen that had nothing left to do. Prefetching here moves
   * that work under the form, where it costs nothing — by the time credentials
   * are submitted the destination is usually ready.
   *
   * Both are warmed because which one is used depends on a role that is not
   * known until the session comes back.
   */
  useEffect(() => {
    router.prefetch("/admin");
    router.prefetch("/profile");
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      if (result?.error) {
        toast.error(result.error);
        setLoading(false);
      } else {
        toast.success(`Welcome back to ${storeName}`);
        setShowSuccessLoader(true);

        const response = await fetch("/api/auth/session");
        const session = await response.json();
        const callbackUrl = searchParams.get("callbackUrl");
        const safeCallback =
          callbackUrl &&
          callbackUrl.startsWith("/") &&
          !callbackUrl.startsWith("//")
            ? callbackUrl
            : null;

        /*
         * Long enough to read, short enough not to be a wait.
         *
         * This was 2500ms, and nothing happened during it: the session had
         * already come back, so the splash was pure delay stacked on top of an
         * authenticate that takes about a second of its own (half of it the
         * bcrypt compare, which is deliberate and stays). Six hundred
         * milliseconds still lets the panel fade in and register as a
         * confirmation rather than a flash.
         */
        setTimeout(() => {
          if (session?.user?.role === "admin") {
            router.push(safeCallback || "/admin");
          } else {
            router.push(safeCallback || "/profile");
          }
          router.refresh();
        }, 600);
      }
    } catch {
      toast.error("An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen pt-10 bg-white flex flex-col">
      {navbar}
      {showSuccessLoader && <LoginSuccessLoader storeName={storeName} />}

      <section className="flex-1 flex items-center justify-center pt-40 pb-24 px-6">
        <div className="w-full max-w-112.5 space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
              Login
            </h1>
            <p className="text-[11px] uppercase tracking-widest font-bold opacity-80">
              Access your {storeName} collection
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-[10px] uppercase tracking-widest font-bold opacity-90"
              >
                Email Address
              </label>
              <div className="relative group input-standard">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 group-focus-within:text-[#333] transition-colors">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label
                  htmlFor="password"
                  className="text-[10px] uppercase tracking-widest font-bold opacity-90"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-[10px] uppercase tracking-widest font-bold opacity-90 hover:opacity-800 transition-opacity"
                >
                  Forgot?
                </Link>
              </div>
              <div className="relative group input-standard">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 group-focus-within:text-[#333] transition-colors">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-14 pr-14 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-[#333]/20 hover:text-[#333] transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#333] text-white h-14 uppercase tracking-[0.3em] text-[11px] font-bold hover:bg-black transition-all group relative overflow-hidden disabled:opacity-80 flex items-center justify-center"
            >
              <span className={"flex items-center justify-center gap-2"}>
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <SpinnerLoader className="w-6! h-6!" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    Login
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                )}
              </span>
            </button>
          </form>

          <div className="text-center pt-4">
            <p className="text-[11px] uppercase tracking-widest font-bold opacity-90">
              Don&apos;t have an account?{" "}
              <Link
                href="/register"
                className="text-[#333] border-b border-[#333]/20 hover:border-[#333] transition-all pb-0.5 ml-1"
              >
                Create one
              </Link>
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
