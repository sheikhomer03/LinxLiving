"use client";
import React, { useState } from "react";
import { changePassword } from "@/actions/auth";
import { toast } from "sonner";
import SpinnerLoader from "@/components/common/SpinnerLoader";
import { Eye, EyeOff } from "lucide-react";

export function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleUpdate = async () => {
    // ... validation and call ...
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Please fill in all fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await changePassword({ currentPassword, newPassword });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Password updated successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-2xl">
      <div className="space-y-2">
        <h3 className="text-xl font-serif tracking-widest uppercase">
          Change Password
        </h3>
      </div>

      <div className="space-y-6 pt-6">
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-foreground">
            Current Password:
          </label>
          <div className="relative group">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Current Password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-white px-4 py-3 pr-12 text-sm transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/20 hover:text-foreground transition-colors"
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
          <label className="text-[11px] font-bold text-foreground">
            New Password:
          </label>
          <div className="relative group">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-white px-4 py-3 pr-12 text-sm transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/20 hover:text-foreground transition-colors"
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
          <label className="text-[11px] font-bold text-foreground">
            Confirm New Password:
          </label>
          <div className="relative group">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-white border border-foreground/10 px-4 py-3 pr-12 text-sm focus:border-foreground/30 outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/20 hover:text-foreground transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={handleUpdate}
        disabled={loading}
        className="w-full md:w-auto h-14 px-12 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-[#1a1a1a] transition-colors flex items-center justify-center min-w-[200px]"
      >
        {loading ? <SpinnerLoader className="w-6! h-6!" /> : "Update Password"}
      </button>
    </div>
  );
}
