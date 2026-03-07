import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import Link from "next/link";
import { ArrowRight, Mail, Lock } from "lucide-react";
import Image from "next/image";
import { getStoreName } from "@/app/actions/settings";

const SIGNATURE_IMAGE = "/images/tiles6.jpg";

export default async function SignupPage() {
  const storeName = await getStoreName();

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="flex-1 grid grid-cols-1 lg:grid-cols-2">
        <div className="hidden lg:block relative h-full min-h-[600px]">
          <Image
            src={SIGNATURE_IMAGE}
            alt="Luxury Interior"
            fill
            className="object-cover grayscale"
          />
          <div className="absolute inset-0 bg-black/20" />
        </div>

        <div className="flex flex-col items-center justify-center px-6 pt-72 pb-40">
          <div className="w-full max-w-lg space-y-16">
            <div className="text-center space-y-6">
              <h1 className="text-4xl md:text-5xl font-serif tracking-tight uppercase leading-none text-[#333]">
                Join {storeName}
              </h1>
              <p className="text-muted-foreground uppercase tracking-[0.3em] text-[10px] font-bold">
                Curate your architectural vision
              </p>
            </div>

            <form className="space-y-8 group">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-90">
                    Full Name
                  </label>
                  <div className="relative group input-standard">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 group-focus-within:text-[#333] transition-colors">
                      <ArrowRight className="w-4 h-4 -rotate-45" />
                    </div>
                    <input
                      type="text"
                      placeholder="ENTER YOUR NAME"
                      className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400 placeholder:text-[10px] placeholder:tracking-widest"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-90">
                    Email Address
                  </label>
                  <div className="relative group input-standard">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 group-focus-within:text-[#333] transition-colors">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      placeholder="ENTER YOUR EMAIL"
                      className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400 placeholder:text-[10px] placeholder:tracking-widest"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold opacity-90">
                    Password
                  </label>
                  <div className="relative group input-standard">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 group-focus-within:text-[#333] transition-colors">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type="password"
                      placeholder="ENTER YOUR PASSWORD"
                      className="w-full pl-14 pr-6 py-4 bg-white transition-all text-sm font-sans outline-none placeholder:text-gray-400 placeholder:text-[10px] placeholder:tracking-widest"
                      required
                    />
                  </div>
                </div>
              </div>

              <button className="w-full bg-[#333] text-white py-5 uppercase tracking-[0.3em] text-[10px] font-bold hover:bg-black transition-all flex items-center justify-center gap-3">
                Request Membership
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="flex justify-center items-center gap-6 pt-12 border-t border-foreground/10">
              <span className="uppercase tracking-[0.3em] text-[10px] font-bold opacity-80 italic">
                Already a member?
              </span>
              <Link
                href="/login"
                className="text-[10px] uppercase tracking-[0.3em] font-bold border-b border-foreground pb-1"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
