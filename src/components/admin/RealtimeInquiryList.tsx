"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RealtimeInquiryList({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    // Poll for new inquiries every 30 seconds
    const interval = setInterval(() => {
      router.refresh();
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

  return <>{children}</>;
}
