"use client";

import React, { useState } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { registerUser } from "@/actions/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import SpinnerLoader from "@/components/common/SpinnerLoader";

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const result = await registerUser({
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Account created successfully");
        router.push("/login?registered=true");
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  return (
    <main className="min-h-screen bg-white pt-10 flex flex-col">
      <Navbar />

      <section className="flex-1 flex items-center justify-center pt-40 pb-24 px-6">
        <div className="w-full max-w-[450px] space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
              Join Linx Living
            </h1>
            <p className="text-[11px] uppercase tracking-widest font-bold opacity-40">
              Begin your luxury architectural journey
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="name"
                className="text-[10px] uppercase tracking-widest font-bold opacity-60"
              >
                Full Name
              </label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  id="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-[10px] uppercase tracking-widest font-bold opacity-60"
              >
                Email Address
              </label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-[10px] uppercase tracking-widest font-bold opacity-60"
              >
                Password
              </label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full pl-14 pr-14 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                  placeholder="Create a password"
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

            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="text-[10px] uppercase tracking-widest font-bold opacity-60"
              >
                Confirm Password
              </label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#333]/20 group-focus-within:text-[#333] transition-colors">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="w-full pl-14 pr-14 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400"
                  placeholder="Confirm your password"
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
              className="w-full bg-[#333] text-white h-14 uppercase tracking-[0.3em] text-[11px] font-bold hover:bg-black transition-all group relative overflow-hidden disabled:opacity-50 flex items-center justify-center"
            >
              <span className={"flex items-center justify-center gap-2"}>
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <SpinnerLoader className="w-6! h-6!" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    Register Account
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                )}
              </span>
            </button>
          </form>

          <div className="text-center pt-4">
            <p className="text-[11px] uppercase tracking-widest font-bold opacity-40">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-[#333] border-b border-[#333]/20 hover:border-[#333] transition-all pb-0.5 ml-1"
              >
                Log in
              </Link>
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
