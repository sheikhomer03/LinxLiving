import { Footer } from "@/components/layout/Footer";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function SuccessPage() {
  return (
    <main className="min-h-screen bg-white">
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-md mx-auto">
          <div className="space-y-8 text-center animate-in fade-in zoom-in duration-700">
            <div className="flex justify-center">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center shadow-sm">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-serif tracking-widest uppercase">
                Vault Secured
              </h1>
              <p className="text-sm text-muted-foreground font-sans">
                Your credentials have been updated. You may now proceed to log
                in.
              </p>
            </div>

            <Link
              href="/login"
              className="inline-block px-16 py-5 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all shadow-xl shadow-black/10"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
