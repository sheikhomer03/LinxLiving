import { Suspense } from "react";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { Footer } from "@/components/layout/Footer";
import SpinnerLoader from "@/components/common/SpinnerLoader";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen pt-10 bg-white flex flex-col">
          <StorefrontNavbar />
          <div className="flex-1 flex items-center justify-center">
            <SpinnerLoader className="w-8 h-8" />
          </div>
          <Footer />
        </main>
      }
    >
      <LoginForm navbar={<StorefrontNavbar />} />
    </Suspense>
  );
}
