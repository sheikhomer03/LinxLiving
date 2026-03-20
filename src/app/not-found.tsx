import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import Link from "next/link";
import { MoveRight } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-12 bg-white">
        <div className="space-y-6 mt-28 md:mt-48 lg:mt-60">
          <p className="uppercase tracking-[0.4em] text-[10px] font-bold text-primary animate-in fade-in slide-in-from-bottom-4 duration-700">
            Error 404
          </p>
          <h1 className="text-3xl md:text-5xl font-serif tracking-widest leading-tight italic animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-100">
            Page <br /> Not{" "}
            <span className="text-secondary-foreground/20 italic">Exists</span>
          </h1>
          <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto font-medium text-xs md:text-sm uppercase tracking-widest animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200">
            The page you are looking for has been moved or archived. We invite
            you to continue exploring our curated collection of architectural
            statements.
          </p>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-10 mb-16 duration-1000 delay-500">
          <Link href="/">
            <button className="group flex items-center gap-6 bg-primary text-primary-foreground px-7 py-4 uppercase tracking-[0.4em] text-[10px] font-bold hover:bg-black hover:text-white transition-all shadow-2xl shadow-primary/10">
              Explore Products
              <MoveRight className="w-5 h-5 group-hover:translate-x-3 transition-transform duration-500" />
            </button>
          </Link>
        </div>
      </div>
      <Footer />
    </main>
  );
}
