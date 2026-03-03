"use client";
import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { updateProfile } from "@/actions/auth";
import { toast } from "sonner";
import SpinnerLoader from "@/components/common/SpinnerLoader";
import { PersonalDetailsSkeleton } from "./ProfileSkeletons";

export function PersonalDetails() {
  const { data: session, status, update } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session?.user) {
      setName(session.user.name || "");
      setEmail(session.user.email || "");
    }
  }, [session]);

  const handleUpdate = async () => {
    if (!name) {
      toast.error("Please enter your name");
      return;
    }

    setLoading(true);
    try {
      const result = await updateProfile({ name });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Profile updated successfully");
        await update({ name });
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return <PersonalDetailsSkeleton />;
  }

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-2xl">
      <div className="space-y-2">
        <h3 className="text-xl font-serif tracking-widest uppercase">
          Personal Details
        </h3>
      </div>

      <div className="space-y-6 pt-6">
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-foreground">Full Name:</p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-white px-4 py-3 text-sm font-sans transition-colors"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-[11px] font-bold text-foreground">
              Email Address:
            </p>
            <span className="text-[9px] uppercase tracking-widest font-bold opacity-30">
              Cannot be edited
            </span>
          </div>
          <input
            type="email"
            value={email}
            disabled
            className="w-full bg-secondary/20 px-4 py-3 text-sm font-sans opacity-60 cursor-not-allowed"
          />
          <p className="text-[10px] opacity-40 italic">
            Email address is locked for account security.
          </p>
        </div>
      </div>

      <button
        onClick={handleUpdate}
        disabled={loading}
        className="w-full md:w-auto px-12 h-14 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-[#1a1a1a] transition-colors flex items-center justify-center min-w-[200px]"
      >
        {loading ? <SpinnerLoader className="w-6! h-6!" /> : "Update Details"}
      </button>
    </div>
  );
}
