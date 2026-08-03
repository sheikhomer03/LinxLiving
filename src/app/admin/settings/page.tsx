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
  ShoppingBag,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSettings,
  updateAccountSettings,
  updateSecuritySettings,
  verifyAndSaveResend,
} from "@/app/actions/settings";
import {
  syncAllUnsyncedProductsToShopify,
  pullShopifyProductsIntoMongo,
  pullEverythingFromShopify,
  pullShopifyCouponsIntoMongo,
  enableShopifyProductWebhooks,
} from "@/app/actions/shopify";
import { useSession } from "next-auth/react";
import { notifyCatalogChange } from "@/lib/live-sync";

type Section = "account" | "security" | "email" | "shopify";

type ShopifyStatus = {
  configured: boolean;
  syncEnabled: boolean;
  storefrontEnabled: boolean;
  checkoutEnabled?: boolean;
  storeDomain?: string;
  apiVersion?: string;
  hasStorefrontToken?: boolean;
  health: { ok: boolean; shop?: string; locationId?: string | null; error?: string };
};

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const [activeSection, setActiveSection] = useState<Section>("account");
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [shopifyStatus, setShopifyStatus] = useState<ShopifyStatus | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullingCoupons, setPullingCoupons] = useState(false);
  const [registeringWebhooks, setRegisteringWebhooks] = useState(false);
  const [creatingStorefrontToken, setCreatingStorefrontToken] = useState(false);

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
    notificationEmail: "",
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
          notificationEmail: data.notificationEmail || "",
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

  const loadShopifyStatus = async () => {
    setShopifyLoading(true);
    try {
      const res = await fetch("/api/admin/shopify/status");
      const data = await res.json();
      setShopifyStatus(data);
    } catch {
      toast.error("Failed to load Shopify status");
    } finally {
      setShopifyLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === "shopify") {
      loadShopifyStatus();
    }
  }, [activeSection]);

  const handleBulkShopifySync = async () => {
    setBulkSyncing(true);
    try {
      const result = await syncAllUnsyncedProductsToShopify(25);
      if (!result.success) {
        toast.error(result.error || "Bulk sync failed");
      } else {
        toast.success(
          `Pushed ${result.synced} product(s) to Shopify${result.failed ? `, ${result.failed} failed` : ""}`,
        );
      }
      await loadShopifyStatus();
    } catch (error: any) {
      toast.error(error.message || "Bulk sync failed");
    } finally {
      setBulkSyncing(false);
    }
  };

  const handlePullFromShopify = async () => {
    setPulling(true);
    try {
      const result = await pullEverythingFromShopify(50);
      if (!result.success) {
        toast.error(result.error || "Pull from Shopify failed");
      } else {
        const parts = Object.entries(result.results || {}).map(
          ([key, val]: [string, any]) =>
            `${key}: ${val.ok ? val.pulled ?? "ok" : val.error || "fail"}`,
        );
        toast.success(`Shopify pull done — ${parts.join(" · ")}`);
        notifyCatalogChange("all");
      }
    } catch (error: any) {
      toast.error(error.message || "Pull from Shopify failed");
    } finally {
      setPulling(false);
    }
  };

  const handlePullCoupons = async () => {
    setPullingCoupons(true);
    try {
      const result = await pullShopifyCouponsIntoMongo(50);
      if (!result.success) {
        toast.error(result.error || "Coupon pull failed");
      } else {
        toast.success(
          `Coupons pulled: ${result.pulled}${result.codes?.length ? ` (${result.codes.join(", ")})` : ""}`,
        );
      }
    } catch (error: any) {
      toast.error(error.message || "Coupon pull failed");
    } finally {
      setPullingCoupons(false);
    }
  };

  const handleCreateStorefrontToken = async () => {
    setCreatingStorefrontToken(true);
    try {
      const res = await fetch("/api/admin/shopify/storefront-token", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create Storefront token", {
          duration: 12000,
        });
        if (data.fix?.scopes?.length) {
          console.info(
            "Add these Storefront scopes as REQUIRED on the app, then release + reinstall:",
            data.fix.scopes,
          );
        }
        return;
      }
      await navigator.clipboard.writeText(data.accessToken);
      toast.success(
        "Storefront token created and copied. Paste into .env as SHOPIFY_STOREFRONT_ACCESS_TOKEN, then restart.",
      );
      await loadShopifyStatus();
    } catch (error: any) {
      toast.error(error.message || "Failed to create Storefront token");
    } finally {
      setCreatingStorefrontToken(false);
    }
  };

  const handleRegisterWebhooks = async () => {
    setRegisteringWebhooks(true);
    try {
      const result = await enableShopifyProductWebhooks();
      if (!result.success) {
        toast.error(result.error || "Webhook registration failed");
      } else {
        const created =
          result.results?.filter((r: { action: string }) => r.action === "created")
            .length ?? 0;
        const exists =
          result.results?.filter((r: { action: string }) => r.action === "exists")
            .length ?? 0;
        const errors =
          result.results?.filter((r: { action: string }) => r.action === "error") ??
          [];
        if (errors.length) {
          toast.error(
            errors
              .map(
                (e: { topic: string; error?: string }) =>
                  `${e.topic}: ${e.error}`,
              )
              .join(" · "),
          );
        } else {
          toast.success(
            `Webhooks ready (${created} created, ${exists} already set) → ${result.callbackUrl}`,
          );
        }
      }
    } catch (error: any) {
      toast.error(error.message || "Webhook registration failed");
    } finally {
      setRegisteringWebhooks(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Loader2 className="w-12 h-12 text-primary animate-spin opacity-90" />
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-primary/60">
          Synchronizing Vault
        </p>
      </div>
    );
  }

  const navItems = [
    { id: "account", label: "Account Details", icon: Globe },
    { id: "security", label: "Security & Privacy", icon: ShieldCheck },
    { id: "email", label: "Email Integration", icon: Mail },
    { id: "shopify", label: "Shopify", icon: ShoppingBag },
  ];

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Premium Header */}
      <header className="space-y-4 border-b border-stone-200 pb-5">
        <h1 className="admin-page-title font-serif text-stone-800">
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
              className={`flex items-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] uppercase tracking-[0.16em] font-black transition-all relative overflow-hidden group rounded-t-lg ${
                activeSection === item.id
                  ? "text-stone-800 bg-primary/10 border border-b-0 border-primary/20"
                  : "text-stone-500 hover:text-stone-800 hover:bg-stone-50"
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
          <div className="admin-page">
            <section className="bg-white p-4 sm:p-6 border border-stone-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.02)] admin-page">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-stone-800 font-bold">
                    Store Settings
                  </h2>
                </div>
                <button
                  onClick={handleAccountSave}
                  disabled={isSaving}
                  className="w-full sm:w-auto bg-primary text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-4 shadow-sm disabled:opacity-80"
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
                  <label className="text-[10px] uppercase tracking-[0.16em] font-bold opacity-80 flex items-center gap-3">
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
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none"
                    placeholder={`e.g., ${accountData.storeName || "MY STORE"}`}
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
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
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none"
                    placeholder="Full Name"
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80 flex items-center gap-3">
                    Logged-in Email{" "}
                    <span className="text-[8px] opacity-80 ml-auto italic hidden sm:inline">
                      (Read-only)
                    </span>
                  </label>
                  <input
                    type="email"
                    value={accountData.adminEmail}
                    readOnly
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none opacity-90 cursor-not-allowed"
                    placeholder="info@linxsquare.co.uk"
                  />
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Section: Security */}
        {activeSection === "security" && (
          <div className="admin-page">
            <section className="bg-white p-4 sm:p-6 border border-stone-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.02)] admin-page">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-stone-800 font-bold">
                    Security Settings
                  </h2>
                  <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-90 font-bold">
                    Hardening administrative access and protocol keys.
                  </p>
                </div>
                <button
                  onClick={handleSecuritySave}
                  disabled={isSaving}
                  className="w-full sm:w-auto bg-primary text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-4 shadow-sm disabled:opacity-80"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                  Update Password
                </button>
              </div>

              <div className="max-w-xl space-y-5">
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
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
                      className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none pr-16"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPass(!showCurrentPass)}
                      className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 transition-colors"
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
                    <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
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
                        className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none pr-16"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPass(!showNewPass)}
                        className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 transition-colors"
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
                    <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
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
                        className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none pr-16"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                        className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 transition-colors"
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
          <div className="admin-page">
            <section className="bg-white p-4 sm:p-6 border border-stone-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.02)] admin-page">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-stone-800 font-bold">
                    Email Integration
                  </h2>
                  <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-90 font-bold">
                    Automated dispatch using Resend API protocols.
                  </p>
                </div>
                <button
                  onClick={handleResendVerify}
                  disabled={isVerifying}
                  className="w-full sm:w-auto bg-primary text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-4 shadow-sm disabled:opacity-80"
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
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
                    Resend API Key
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={resendData.resendApiKey}
                      onChange={(e) =>
                        setResendData({ ...resendData, resendApiKey: e.target.value })
                      }
                      className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none pr-16"
                      placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                    <Key className="absolute right-5 lg:right-6 top-1/2 -translate-y-1/2 w-4 h-4 opacity-90" />
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
                    Sender Email
                  </label>
                  <input
                    type="email"
                    value={resendData.emailFrom}
                    onChange={(e) =>
                      setResendData({ ...resendData, emailFrom: e.target.value })
                    }
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none"
                    placeholder="noreply@linxsquare.co.uk"
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[9px] lg:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
                    Notification Inbox
                  </label>
                  <input
                    type="email"
                    value={resendData.notificationEmail}
                    onChange={(e) =>
                      setResendData({
                        ...resendData,
                        notificationEmail: e.target.value,
                      })
                    }
                    className="w-full input-standard bg-secondary/5 px-5 lg:px-6 py-2 text-sm font-serif tracking-wide text-stone-800 outline-none"
                    placeholder="info@linxsquare.co.uk"
                  />
                  <p className="text-[10px] opacity-60 leading-relaxed">
                    Contact enquiries and new-order alerts are delivered here.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeSection === "shopify" && (
          <div className="admin-page">
            <section className="bg-white p-4 sm:p-6 border border-stone-200/80 shadow-[0_20px_50px_rgba(0,0,0,0.02)] admin-page space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="space-y-2">
                  <h2 className="text-lg lg:text-xl font-serif text-stone-800 font-bold">
                    Shopify Connection
                  </h2>
                  <p className="text-[9px] lg:text-[10px] uppercase tracking-widest opacity-90 font-bold">
                    Admin product create/update syncs to Shopify when configured.
                  </p>
                </div>
                <button
                  onClick={loadShopifyStatus}
                  disabled={shopifyLoading}
                  className="w-full sm:w-auto bg-primary text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-4 shadow-sm disabled:opacity-80"
                >
                  {shopifyLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Refresh status
                </button>
              </div>

              {shopifyLoading && !shopifyStatus ? (
                <div className="flex items-center gap-3 text-stone-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking Shopify…
                </div>
              ) : shopifyStatus ? (
                <div className="space-y-4">
                  <div
                    className={`rounded-lg border px-4 py-3 text-sm ${
                      shopifyStatus.health.ok
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}
                  >
                    {shopifyStatus.health.ok ? (
                      <p>
                        Connected to <strong>{shopifyStatus.health.shop}</strong>
                      </p>
                    ) : (
                      <p>
                        Not connected:{" "}
                        {shopifyStatus.health.error || "Check .env.local"}
                      </p>
                    )}
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-stone-700">
                    <div className="border border-stone-200 rounded-lg px-4 py-3">
                      <dt className="text-[10px] uppercase tracking-widest font-bold text-stone-500">
                        Store domain
                      </dt>
                      <dd className="mt-1 font-mono text-xs">
                        {shopifyStatus.storeDomain || "—"}
                      </dd>
                    </div>
                    <div className="border border-stone-200 rounded-lg px-4 py-3">
                      <dt className="text-[10px] uppercase tracking-widest font-bold text-stone-500">
                        API version
                      </dt>
                      <dd className="mt-1">{shopifyStatus.apiVersion || "—"}</dd>
                    </div>
                    <div className="border border-stone-200 rounded-lg px-4 py-3">
                      <dt className="text-[10px] uppercase tracking-widest font-bold text-stone-500">
                        Admin sync
                      </dt>
                      <dd className="mt-1">
                        {shopifyStatus.syncEnabled ? "Enabled" : "Disabled"}
                      </dd>
                    </div>
                    <div className="border border-stone-200 rounded-lg px-4 py-3">
                      <dt className="text-[10px] uppercase tracking-widest font-bold text-stone-500">
                        Storefront reads
                      </dt>
                      <dd className="mt-1">
                        {shopifyStatus.storefrontEnabled
                          ? "Enabled"
                          : "Off (Mongo still serves the shop)"}
                      </dd>
                    </div>
                    <div className="border border-stone-200 rounded-lg px-4 py-3">
                      <dt className="text-[10px] uppercase tracking-widest font-bold text-stone-500">
                        Shopify Checkout
                      </dt>
                      <dd className="mt-1">
                        {shopifyStatus.checkoutEnabled
                          ? "Enabled (cart → Shopify)"
                          : shopifyStatus.hasStorefrontToken
                            ? "Token set — enable SHOPIFY_CHECKOUT_ENABLED"
                            : "Needs Storefront token"}
                      </dd>
                    </div>
                    <div className="border border-stone-200 rounded-lg px-4 py-3 sm:col-span-2">
                      <dt className="text-[10px] uppercase tracking-widest font-bold text-stone-500">
                        Primary location
                      </dt>
                      <dd className="mt-1 font-mono text-xs break-all">
                        {shopifyStatus.health.locationId || "—"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
                    <button
                      onClick={handlePullFromShopify}
                      disabled={
                        pulling ||
                        !shopifyStatus.configured ||
                        !shopifyStatus.health.ok
                      }
                      className="bg-emerald-800 text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {pulling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Pull everything from Shopify
                    </button>
                    <button
                      onClick={handlePullCoupons}
                      disabled={
                        pullingCoupons ||
                        !shopifyStatus.configured ||
                        !shopifyStatus.health.ok
                      }
                      className="bg-emerald-700 text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {pullingCoupons ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Pull coupons only
                    </button>
                    <button
                      onClick={handleBulkShopifySync}
                      disabled={
                        bulkSyncing ||
                        !shopifyStatus.configured ||
                        !shopifyStatus.health.ok
                      }
                      className="bg-stone-800 text-white px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:opacity-90 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {bulkSyncing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Database className="w-4 h-4" />
                      )}
                      Push unsynced to Shopify (max 25)
                    </button>
                    <button
                      onClick={handleRegisterWebhooks}
                      disabled={
                        registeringWebhooks ||
                        !shopifyStatus.configured ||
                        !shopifyStatus.health.ok
                      }
                      className="border border-stone-300 text-stone-800 px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:bg-stone-50 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {registeringWebhooks ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Server className="w-4 h-4" />
                      )}
                      Enable live webhooks
                    </button>
                    <button
                      onClick={handleCreateStorefrontToken}
                      disabled={
                        creatingStorefrontToken ||
                        !shopifyStatus.configured ||
                        !shopifyStatus.health.ok
                      }
                      className="border border-emerald-700 text-emerald-900 px-4 py-2 text-[10px] uppercase tracking-[0.12em] font-bold hover:bg-emerald-50 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {creatingStorefrontToken ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShoppingBag className="w-4 h-4" />
                      )}
                      Create Storefront token
                    </button>
                  </div>

                  <p className="text-xs text-stone-500 leading-relaxed">
                    <strong>Checkout setup:</strong> If{" "}
                    <em>Create Storefront token</em> says Access denied, open{" "}
                    <a
                      href="https://dev.shopify.com/dashboard"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-medium text-stone-700"
                    >
                      Dev Dashboard
                    </a>{" "}
                    → LinxSquare Connector → add these as{" "}
                    <strong>required</strong> scopes (not optional):{" "}
                    <code className="font-mono text-[10px]">
                      unauthenticated_read_product_listings
                    </code>
                    ,{" "}
                    <code className="font-mono text-[10px]">
                      unauthenticated_read_checkouts
                    </code>
                    ,{" "}
                    <code className="font-mono text-[10px]">
                      unauthenticated_write_checkouts
                    </code>
                    . Release, reinstall on the store, then create the token
                    again and paste into{" "}
                    <code className="font-mono">SHOPIFY_STOREFRONT_ACCESS_TOKEN</code>
                    .
                  </p>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Orders sync from Shopify after hosted Checkout. Keep ngrok +{" "}
                    <code className="font-mono">SHOPIFY_WEBHOOK_BASE_URL</code>{" "}
                    for live updates.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
