"use client";

import { useState, useTransition } from "react";
import { updateReviewStatus } from "@/app/actions/reviews";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface ReviewStatusUpdaterProps {
  id: string;
  currentStatus: string;
}

export function ReviewStatusUpdater({
  id,
  currentStatus,
}: ReviewStatusUpdaterProps) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(currentStatus);
  const router = useRouter();

  const handleUpdate = async (newStatus: string) => {
    if (newStatus === status) return;
    if (!["pending", "approved", "rejected"].includes(newStatus)) return;

    startTransition(async () => {
      const result = await updateReviewStatus(
        id,
        newStatus as "pending" | "approved" | "rejected",
      );
      if (result.success) {
        setStatus(newStatus);
        toast.success(`Review marked as ${newStatus}`);
        router.refresh();
      } else {
        toast.error(result.error || "Failed to update status");
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <select
        value={status}
        disabled={isPending}
        onChange={(e) => handleUpdate(e.target.value)}
        className="bg-transparent border border-stone-200 py-2 px-4 text-[10px] uppercase tracking-widest outline-none focus:border-primary transition-colors disabled:opacity-80 h-10"
      >
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>

      {isPending && (
        <div className="w-10 h-10 flex items-center justify-center bg-secondary/20 rounded-sm">
          <Loader2 className="w-4 h-4 animate-spin opacity-80" />
        </div>
      )}
    </div>
  );
}
