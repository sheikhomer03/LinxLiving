"use client";

import { useState, useTransition } from "react";
import { updateQueryStatus } from "@/app/actions/contact";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface StatusUpdaterProps {
  id: string;
  currentStatus: string;
}

export function StatusUpdater({ id, currentStatus }: StatusUpdaterProps) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(currentStatus);
  const router = useRouter();

  const handleUpdate = async (newStatus: string) => {
    if (newStatus === status) return;

    startTransition(async () => {
      const result = await updateQueryStatus(id, newStatus);
      if (result.success) {
        setStatus(newStatus);
        toast.success(`Inquiry marked as ${newStatus}`);
        router.refresh();
      } else {
        toast.error("Failed to update status");
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <select
        value={status}
        disabled={isPending}
        onChange={(e) => handleUpdate(e.target.value)}
        className="bg-transparent border border-[#333]/20 py-2 px-4 text-[10px] uppercase tracking-widest outline-none focus:border-[#333] transition-colors disabled:opacity-80 h-10"
      >
        <option value="pending">Mark Pending</option>
        <option value="replied">Mark Replied</option>
        <option value="archived">Archive</option>
      </select>

      {isPending && (
        <div className="w-10 h-10 flex items-center justify-center bg-secondary/20 rounded-sm">
          <Loader2 className="w-4 h-4 animate-spin opacity-80" />
        </div>
      )}
    </div>
  );
}
