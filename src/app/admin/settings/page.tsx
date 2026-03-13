"use client";

import React, { useState, useEffect } from "react";
import {
  Globe,
  ShieldCheck,
  Mail,
  Save,
  Check,
  ChevronRight,
  Shield,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  Server,
  Key,
  Database,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSettings,
  updateAccountSettings,
  updateSecuritySettings,
  verifyAndSaveResend,
} from "@/app/actions/settings";
import { useSession } from "next-auth/react";

type Section = "account" | "security" | "email";

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const [activeSection, setActiveSection] = useState<Section>("account");
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [accountData, setAccountData] = useState({
    storeName: "",
    adminName: "",
    adminEmail: "",
  });

  const [securityData, setSecurityData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [resendData, setResendData] = useState({
    resendApiKey: "",
    emailFrom: "",
  });

  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  useEffect(() => {
    async function fetchData() {
      const data = await getSettings();
      if (data) {
        setSettings(data);
        setAccountData((prev) => ({
          ...prev,
          storeName: data.storeName || "",
          adminName: session?.user?.name || "",
          adminEmail: session?.user?.email || "",
        }));
        setResendData({
          resendApiKey: data.resendApiKey || "",
          emailFrom: data.emailFrom || "",
        });
      }
      setLoading(false);
    }
    fetchData();
  }, [session]);

  const handleAccountSave = async () => {
    setIsSaving(true);
    const result = await updateAccountSettings(accountData);
    if (result.success) {
      // Trigger session update to reflect across the app in real-time
      if (update) {
        await update({ name: accountData.adminName });
      }
      toast.success("Account settings updated successfully");
    } else {
      toast.error(result.error || "Failed to update settings");
    }
    setIsSaving(false);
  };

  const handleSecuritySave = async () => {
    if (securityData.newPassword !== securityData.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setIsSaving(true);
    const result = await updateSecuritySettings(securityData);
    if (result.success) {
      toast.success("Password updated successfully");
      setSecurityData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } else {
      toast.error(result.error || "Failed to update security");
    }
    setIsSaving(false);
  };

  const handleResendVerify = async () => {
    setIsVerifying(true);
    const result = await verifyAndSaveResend(resendData);
    if (result.success) {
      toast.success("Resend Configuration verified and saved");
    } else {
      toast.error(result.error || "Resend Verification failed");
    }
    setIsVerifying(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Loader2 className="w-12 h-12 text-primary animate-spin opacity-90" />
        <p className="text-[10px] uppercase tracking-[0.4em] font-black text-primary/60">
          Synchronizing Vault
        </p>
      </div>
    );
  }

  const navItems = [
    { id: "account", label: "Account Details", icon: Globe },
    { id: "security", label: "Security & Privacy", icon: ShieldCheck },
    { id: "email", label: "Email Integration", icon: Mail },
  ];

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-1000">
      {/* Premium Header */}
      <header className="space-y-4 border-b border-[#333]/10 pb-5">
        <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
          Settings
        </h1>
      </header>

      {/* Horizontal Premium Navigation */}
      <div className="overflow-x-auto custom-scrollbar -mx-6 px-6 sm:mx-0 sm:px-0">
        <nav className="flex items-center gap-1 sm:gap-2 border-b mt-6 border-primary/5 min-w-max">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id as Section)}
              className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-4 text-[9px] sm:text-[10px] uppercase tracking-[0.3em] font-black transition-all relative overflow-hidden group ${
                activeSection === item.id
                  ? "text-white bg-black"
                  : "text-black hover:text-white hover:bg-black"
              }`}
            >
              <item.icon className="w-3.5 h-3.5 sm:w-4 h-4" />
              <span>{item.label}</span>
              {activeSection === item.id && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-foreground/20 animate-in slide-in-from-left duration-500" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content Area */}
      <div className="animate-in slide-up-8 mt-6 duration-700">
        {/* Section: Account */}
        {activeSection === "account" && (
          <div className="space-y-8 lg:space-y-12">
            <section className="bg-white p-6 sm:p-10 lg:p-12 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 lg:space-y-12">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-[#333] font-bold">
                    Store Settings
                  </h2>
                </div>
                <button
                  onClick={handleAccountSave}
                  disabled={isSaving}
                  className="w-full sm:w-auto bg-primary text-white px-8 lg:px-10 py-3.5 lg:py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.4em] font-bold hover:bg-black transition-all flex items-center justify-center gap-4 shadow-xl disabled:opacity-80"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Details
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 lg:gap-x-16 gap-y-8 lg:gap-y-10">
                <div className="space-y-4">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80 flex items-center gap-3">
                    Store Name
                  </label>
                  <input
                    type="text"
                    value={accountData.storeName}
                    onChange={(e) =>
                      setAccountData({
                        ...accountData,
                        storeName: e.target.value,
                      })
                    }
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none"
                    placeholder={`e.g., ${accountData.storeName || "MY STORE"}`}
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                    Account Name
                  </label>
                  <input
                    type="text"
                    value={accountData.adminName}
                    onChange={(e) =>
                      setAccountData({
                        ...accountData,
                        adminName: e.target.value,
                      })
                    }
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none"
                    placeholder="Full Name"
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80 flex items-center gap-3">
                    Logged-in Email{" "}
                    <span className="text-[8px] opacity-80 ml-auto italic hidden sm:inline">
                      (Read-only)
                    </span>
                  </label>
                  <input
                    type="email"
                    value={accountData.adminEmail}
                    readOnly
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none opacity-90 cursor-not-allowed"
                    placeholder="info@linxliving.co.uk"
                  />
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Section: Security */}
        {activeSection === "security" && (
          <div className="space-y-8 lg:space-y-12">
            <section className="bg-white p-6 sm:p-10 lg:p-12 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 lg:space-y-12">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-[#333] font-bold">
                    Security Settings
                  </h2>
                  <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-90 font-bold">
                    Hardening administrative access and protocol keys.
                  </p>
                </div>
                <button
                  onClick={handleSecuritySave}
                  disabled={isSaving}
                  className="w-full sm:w-auto bg-primary text-white px-8 lg:px-10 py-3.5 lg:py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.4em] font-bold hover:bg-black transition-all flex items-center justify-center gap-4 shadow-xl disabled:opacity-80"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                  Update Password
                </button>
              </div>

              <div className="max-w-xl space-y-8 lg:space-y-10">
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                    Current Master Password
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPass ? "text" : "password"}
                      value={securityData.currentPassword}
                      onChange={(e) =>
                        setSecurityData({
                          ...securityData,
                          currentPassword: e.target.value,
                        })
                      }
                      className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none pr-16"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPass(!showCurrentPass)}
                      className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 text-[#333]/30 hover:text-[#333] transition-colors"
                    >
                      {showCurrentPass ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-10">
                  <div className="space-y-4">
                    <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPass ? "text" : "password"}
                        value={securityData.newPassword}
                        onChange={(e) =>
                          setSecurityData({
                            ...securityData,
                            newPassword: e.target.value,
                          })
                        }
                        className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none pr-16"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPass(!showNewPass)}
                        className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 text-[#333]/30 hover:text-[#333] transition-colors"
                      >
                        {showNewPass ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                      Confirm New
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPass ? "text" : "password"}
                        value={securityData.confirmPassword}
                        onChange={(e) =>
                          setSecurityData({
                            ...securityData,
                            confirmPassword: e.target.value,
                          })
                        }
                        className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none pr-16"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                        className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 text-[#333]/30 hover:text-[#333] transition-colors"
                      >
                        {showConfirmPass ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Section: Email */}
        {activeSection === "email" && (
          <div className="space-y-8 lg:space-y-12">
            <section className="bg-white p-6 sm:p-10 lg:p-12 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 lg:space-y-12">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-[#333] font-bold">
                    Email Integration
                  </h2>
                  <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-90 font-bold">
                    Automated dispatch using Resend API protocols.
                  </p>
                </div>
                <button
                  onClick={handleResendVerify}
                  disabled={isVerifying}
                  className="w-full sm:w-auto bg-primary text-white px-8 lg:px-10 py-3.5 lg:py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.4em] font-bold hover:bg-black transition-all flex items-center justify-center gap-4 shadow-xl disabled:opacity-80"
                >
                  {isVerifying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Server className="w-4 h-4" />
                  )}
                  Verify & Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 lg:gap-x-16 gap-y-8 lg:gap-y-10">
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                    Resend API Key
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={resendData.resendApiKey}
                      onChange={(e) =>
                        setResendData({ ...resendData, resendApiKey: e.target.value })
                      }
                      className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none pr-16"
                      placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                    <Key className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 w-4 h-4 opacity-90" />
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
                    Sender Email
                  </label>
                  <input
                    type="email"
                    value={resendData.emailFrom}
                    onChange={(e) =>
                      setResendData({ ...resendData, emailFrom: e.target.value })
                    }
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-5 text-sm font-serif tracking-wide text-[#333] outline-none"
                    placeholder="info@linxliving.co.uk"
                  />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
