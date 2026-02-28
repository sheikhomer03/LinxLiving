"use client";

import React, { useState } from "react";
import {
  Globe,
  ShieldCheck,
  Bell,
  Database,
  Save,
  Check,
  ChevronRight,
  Shield,
  Lock,
  Eye,
  Activity,
  Trash2,
} from "lucide-react";

type Section = "profile" | "security" | "notifications" | "system";

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("profile");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 1200);
  };

  const sections = [
    { id: "profile", label: "Store Profile", icon: Globe },
    { id: "security", label: "Security & Privacy", icon: ShieldCheck },
    { id: "notifications", label: "Preferences", icon: Bell },
    { id: "system", label: "Environment", icon: Database },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-16 pb-40 animate-in fade-in duration-1000">
      {/* Editorial Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between border-b border-[#333]/10 pb-12 gap-8">
        <div className="space-y-4">
          <h1 className="text-6xl font-serif tracking-tight text-[#333] font-bold">
            Settings
          </h1>
          <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-30">
            System Configuration • Registry v2.0.4
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`flex items-center gap-4 px-12 py-5 text-[11px] uppercase tracking-[0.4em] font-bold transition-all duration-700 shadow-xl relative overflow-hidden group ${
            saveSuccess
              ? "bg-green-600 text-white"
              : "bg-[#333] text-white hover:bg-black"
          }`}
        >
          <div className="relative z-10 flex items-center gap-4">
            {saveSuccess ? (
              <Check className="w-5 h-5 animate-in zoom-in duration-500" />
            ) : (
              <Save
                className={`w-5 h-5 ${isSaving ? "animate-pulse" : "group-hover:scale-110 transition-transform"}`}
              />
            )}
            <span>
              {isSaving
                ? "Synchronizing..."
                : saveSuccess
                  ? "Finalized"
                  : "Save Changes"}
            </span>
          </div>
          {saveSuccess && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20 animate-out fade-out duration-3000 fill-mode-forwards" />
          )}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
        {/* Studio Sidebar */}
        <aside className="lg:col-span-3 space-y-4 sticky top-12">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id as Section)}
              className={`w-full flex items-center justify-between px-8 py-6 transition-all duration-500 group ${
                activeSection === section.id
                  ? "bg-white border border-[#333]/10 shadow-[0_10px_30px_rgba(0,0,0,0.03)]"
                  : "opacity-40 hover:opacity-100 hover:translate-x-2"
              }`}
            >
              <div className="flex items-center gap-5">
                <section.icon
                  className={`w-5 h-5 stroke-[1.5] ${activeSection === section.id ? "text-[#333]" : ""}`}
                />
                <span
                  className={`text-[11px] uppercase tracking-[0.2em] font-bold ${activeSection === section.id ? "text-[#333]" : ""}`}
                >
                  {section.label}
                </span>
              </div>
              {activeSection === section.id && (
                <ChevronRight className="w-4 h-4 text-[#333]/20" />
              )}
            </button>
          ))}
        </aside>

        {/* Content Area */}
        <div className="lg:col-span-9 animate-in slide-in-from-right-8 duration-700">
          {/* Section: Profile */}
          {activeSection === "profile" && (
            <div className="space-y-12">
              <section className="bg-white p-12 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-12">
                <div className="space-y-2">
                  <h2 className="text-2xl font-serif text-[#333] font-bold">
                    Store Details
                  </h2>
                  <p className="text-[10px] uppercase tracking-widest opacity-30">
                    Essential identity of the digital storefront.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-4">
                    <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-50">
                      Store Name
                    </label>
                    <input
                      type="text"
                      defaultValue="LINX LIVING"
                      className="w-full bg-secondary/20 border-b border-[#333]/10 px-6 py-5 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                    />
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-50">
                      Legal Entity
                    </label>
                    <input
                      type="text"
                      defaultValue="Linx Living Luxe Ltd."
                      className="w-full bg-secondary/20 border-b border-[#333]/10 px-6 py-5 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-4">
                    <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-50">
                      Concierge Email
                    </label>
                    <input
                      type="email"
                      defaultValue="concierge@linxliving.com"
                      className="w-full bg-secondary/20 border-b border-[#333]/10 px-6 py-5 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                    />
                  </div>
                </div>
              </section>

              <section className="bg-white p-12 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-12">
                <div className="space-y-2">
                  <h2 className="text-2xl font-serif text-[#333] font-bold">
                    Localization
                  </h2>
                  <p className="text-[10px] uppercase tracking-widest opacity-30">
                    Regional parameters and fiscal governance.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-4">
                    <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-50">
                      Base Currency
                    </label>
                    <div className="relative group">
                      <select className="w-full bg-secondary/20 border-b border-[#333]/10 px-6 py-5 text-[11px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all appearance-none cursor-pointer">
                        <option>GBP (£)</option>
                        <option>EUR (€)</option>
                        <option>USD ($)</option>
                      </select>
                      <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none rotate-90" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-50">
                      Fiscal Strategy
                    </label>
                    <div className="flex items-center gap-6 h-14">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="w-5 h-5 accent-[#333]"
                      />
                      <span className="text-[11px] uppercase tracking-widest font-bold opacity-60">
                        Auto-calculate VAT
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Section: Security */}
          {activeSection === "security" && (
            <div className="space-y-12">
              <section className="bg-white p-12 border border-[#333]/5 shadow-[0_20px_50_rgba(0,0,0,0.02)] space-y-12 text-[#333]">
                <div className="space-y-2">
                  <h2 className="text-2xl font-serif font-bold">
                    Defense Matrix
                  </h2>
                  <p className="text-[10px] uppercase tracking-widest opacity-30">
                    Protecting the digital sanctuary and its protocols.
                  </p>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between py-6 border-b border-secondary/30 group">
                    <div className="flex items-center gap-6">
                      <div className="p-4 bg-secondary/10 group-hover:bg-[#333] group-hover:text-white transition-all duration-700">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-[0.2em] font-bold">
                          Two-Factor Encryption
                        </p>
                        <p className="text-[9px] opacity-40 uppercase tracking-widest">
                          Enhanced biometric & SMS validation
                        </p>
                      </div>
                    </div>
                    <div className="w-12 h-6 bg-[#333] rounded-full relative cursor-pointer flex items-center justify-end px-1 shadow-inner">
                      <div className="w-4 h-4 bg-white rounded-full shadow-md" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-6 border-b border-secondary/30 group">
                    <div className="flex items-center gap-6">
                      <div className="p-4 bg-secondary/10 group-hover:bg-[#333] group-hover:text-white transition-all duration-700">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-[0.2em] font-bold">
                          Session Hardening
                        </p>
                        <p className="text-[9px] opacity-40 uppercase tracking-widest">
                          Terminate idle administrative portals
                        </p>
                      </div>
                    </div>
                    <div className="w-12 h-6 bg-secondary/30 rounded-full relative cursor-pointer flex items-center px-1">
                      <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-6 border-b border-secondary/30 group">
                    <div className="flex items-center gap-6">
                      <div className="p-4 bg-secondary/10 group-hover:bg-[#333] group-hover:text-white transition-all duration-700">
                        <Eye className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-[0.2em] font-bold">
                          Audit Chronicle
                        </p>
                        <p className="text-[9px] opacity-40 uppercase tracking-widest">
                          Logged record of all state transitions
                        </p>
                      </div>
                    </div>
                    <button className="text-[10px] uppercase font-bold tracking-[0.3em] px-6 py-2 border border-[#333]/10 hover:bg-[#333] hover:text-white transition-all">
                      Review
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Section: Notifications */}
          {activeSection === "notifications" && (
            <div className="space-y-12">
              <section className="bg-white p-12 border border-[#333]/5 shadow-[0_20px_50_rgba(0,0,0,0.02)] space-y-12 text-[#333]">
                <div className="space-y-2">
                  <h2 className="text-2xl font-serif font-bold">
                    Dispatch Control
                  </h2>
                  <p className="text-[10px] uppercase tracking-widest opacity-30">
                    Managing the cadence of digital correspondences.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  <div className="space-y-8">
                    <p className="text-[11px] uppercase tracking-[0.3em] font-bold opacity-30 border-b border-secondary/30 pb-4">
                      Administrative Dispatch
                    </p>
                    {[
                      "Order Acquisition",
                      "Inventory Depletion",
                      "New Patron Entry",
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-widest opacity-60">
                          {item}
                        </span>
                        <div className="w-10 h-5 bg-[#333] rounded-full relative cursor-pointer flex items-center justify-end px-1">
                          <div className="w-3 h-3 bg-white rounded-full shadow-md" />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-8">
                    <p className="text-[11px] uppercase tracking-[0.3em] font-bold opacity-30 border-b border-secondary/30 pb-4">
                      System Alerts
                    </p>
                    {[
                      "Protocol Updates",
                      "Security Breaches",
                      "Database Syncs",
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="text-[10px] uppercase font-bold tracking-widest opacity-60">
                          {item}
                        </span>
                        <div className="w-10 h-5 bg-secondary/30 rounded-full relative cursor-pointer flex items-center px-1">
                          <div className="w-3 h-3 bg-white rounded-full shadow-sm" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Section: System */}
          {activeSection === "system" && (
            <div className="space-y-12 text-[#333]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50_rgba(0,0,0,0.02)] space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-serif font-bold">
                      Health Status
                    </h3>
                    <Activity className="w-5 h-5 text-green-500 animate-pulse" />
                  </div>
                  <div className="space-y-6">
                    <div className="space-y-2 text-right">
                      <p className="text-[10px] uppercase tracking-widest opacity-40">
                        System Uptime
                      </p>
                      <p className="text-2xl font-serif">99.98%</p>
                    </div>
                    <div className="h-px bg-secondary/30" />
                    <div className="space-y-2 text-right">
                      <p className="text-[10px] uppercase tracking-widest opacity-40">
                        Latent Pulse
                      </p>
                      <p className="text-2xl font-serif">42ms</p>
                    </div>
                  </div>
                </section>

                <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50_rgba(0,0,0,0.02)] space-y-8">
                  <h3 className="text-xl font-serif font-bold">Optimization</h3>
                  <div className="space-y-6">
                    <button className="w-full flex items-center justify-between py-3 border-b border-secondary/30 group">
                      <span className="text-[10px] uppercase font-bold tracking-widest opacity-60">
                        Clean Cache Archive
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-20 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-700" />
                    </button>
                    <button className="w-full flex items-center justify-between py-3 border-b border-secondary/30 group">
                      <span className="text-[10px] uppercase font-bold tracking-widest opacity-60">
                        Force Master Synchronization
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-20 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-700" />
                    </button>
                  </div>
                </section>
              </div>

              <section className="bg-red-50/30 border border-red-100 p-12 space-y-10 relative overflow-hidden group">
                <div className="relative z-10 space-y-6">
                  <div className="flex items-center gap-6 text-red-700">
                    <Activity className="w-6 h-6" />
                    <h2 className="text-2xl font-serif font-bold">
                      Vulnerable Protocols
                    </h2>
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.4em] leading-relaxed text-red-900/40 font-bold max-w-xl">
                    Activating maintenance mode will suspend all digital
                    storefront portals. Service will remain accessible
                    exclusively via encrypted administrative pathways.
                  </p>
                  <button className="px-12 py-5 bg-red-600 text-white text-[10px] uppercase tracking-[0.5em] font-bold hover:bg-black transition-all duration-700 shadow-2xl flex items-center gap-4">
                    <AlertCircle className="w-5 h-5" />
                    Enter Maintenance Mode
                  </button>
                </div>
                <Activity className="absolute -bottom-12 -right-12 w-64 h-64 text-red-600/5 rotate-12 transition-transform duration-1000 group-hover:scale-110" />
              </section>

              <button className="w-full py-12 border border-[#333]/5 text-red-500/20 hover:text-red-500 hover:bg-red-50/30 transition-all duration-1000 group">
                <div className="flex flex-col items-center gap-6">
                  <Trash2 className="w-8 h-8 opacity-20 group-hover:opacity-100 transition-all duration-1000" />
                  <span className="text-[10px] uppercase tracking-[0.8em] font-bold">
                    Obliterate All Data Points
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
