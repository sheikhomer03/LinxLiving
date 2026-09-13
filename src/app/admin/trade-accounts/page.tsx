"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import {
  approveTradeAccount,
  getTradeApplications,
  getTradeDepartmentOptions,
  rejectTradeAccount,
  revokeTradeAccount,
  type TradeApplication,
} from "@/app/actions/trade";
import { TRADE_DISCOUNT_PERCENT } from "@/lib/trade";

type Filter = "pending" | "approved" | "rejected" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Declined" },
  { value: "all", label: "All" },
];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Trade account approvals.
 *
 * An application arrives as a user with `tradeStatus: "pending"`, which cannot
 * sign in. Approving here is the only thing in the codebase that sets
 * `isTradeAccount`, and it also fixes which departments the discount covers —
 * the admin can narrow what the applicant asked for before granting it.
 */
export default function TradeAccountsPage() {
  const [applications, setApplications] = useState<TradeApplication[]>([]);
  const [departments, setDepartments] = useState<
    { slug: string; name: string }[]
  >([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Per-row department overrides, keyed by account id. */
  const [scopeEdits, setScopeEdits] = useState<Record<string, Set<string>>>({});
  const [rejecting, setRejecting] = useState<TradeApplication | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getTradeApplications(filter);
    setApplications(res.applications || []);
    setLoading(false);
  }, [filter]);

  // Mount/filter fetch, the same pattern as the other admin tables.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    getTradeDepartmentOptions().then((r) => setDepartments(r.departments || []));
  }, []);

  const scopeFor = (app: TradeApplication) =>
    scopeEdits[app.id] ?? new Set(app.departments);

  const toggleScope = (app: TradeApplication, slug: string) => {
    setScopeEdits((prev) => {
      const next = new Set(prev[app.id] ?? app.departments);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, [app.id]: next };
    });
  };

  const setAllDepartments = (app: TradeApplication) => {
    setScopeEdits((prev) => ({ ...prev, [app.id]: new Set<string>() }));
  };

  const handleApprove = async (app: TradeApplication) => {
    setBusyId(app.id);
    const result = await approveTradeAccount(app.id, [...scopeFor(app)]);
    setBusyId(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`${app.email} approved — they have been emailed`);
    load();
  };

  const handleReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    const result = await rejectTradeAccount(rejecting.id, rejectNote);
    setBusyId(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`${rejecting.email} declined — they have been emailed`);
    setRejecting(null);
    setRejectNote("");
    load();
  };

  const handleRevoke = async (app: TradeApplication) => {
    setBusyId(app.id);
    const result = await revokeTradeAccount(app.id);
    setBusyId(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`${app.email} moved back to awaiting approval`);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-primary">
            Audience
          </p>
          <h1 className="text-xl font-serif tracking-wide text-stone-800">
            Trade accounts
          </h1>
          <p className="mt-1 text-xs text-stone-500">
            Approve an account to give it {TRADE_DISCOUNT_PERCENT}% off. An
            application cannot sign in until it is approved.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] font-bold border transition-colors ${
                filter === f.value
                  ? "border-stone-800 bg-stone-800 text-white"
                  : "border-stone-200 text-stone-500 hover:border-stone-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 border border-stone-200 bg-white p-8 text-sm text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading applications…
        </div>
      ) : applications.length === 0 ? (
        <div className="border border-stone-200 bg-white p-10 text-center">
          <BadgeCheck className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-3 text-sm text-stone-600">
            {filter === "pending"
              ? "No applications awaiting approval."
              : "Nothing here yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => {
            const scope = scopeFor(app);
            const busy = busyId === app.id;
            return (
              <li
                key={app.id}
                className="border border-stone-200 bg-white p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-stone-800">
                        {app.companyName || app.name}
                      </p>
                      <span
                        className={`border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] font-bold ${
                          STATUS_STYLE[app.status] ||
                          "bg-stone-50 text-stone-600 border-stone-200"
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      {app.name} · {app.email}
                      {app.phone ? ` · ${app.phone}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-stone-400">
                      Applied {formatDate(app.appliedAt)}
                      {app.status === "approved"
                        ? ` · approved ${formatDate(app.approvedAt)}`
                        : ""}
                      {app.status === "rejected"
                        ? ` · declined ${formatDate(app.rejectedAt)}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {app.status === "approved" ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleApprove(app)}
                          className="inline-flex items-center gap-1.5 border border-stone-300 px-3 py-2 text-[10px] uppercase tracking-[0.14em] font-bold text-stone-700 hover:border-stone-500 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                          Save departments
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRevoke(app)}
                          className="inline-flex items-center gap-1.5 border border-stone-300 px-3 py-2 text-[10px] uppercase tracking-[0.14em] font-bold text-stone-600 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
                        >
                          <Undo2 className="h-3 w-3" />
                          Revoke
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleApprove(app)}
                          className="inline-flex items-center gap-1.5 bg-emerald-600 px-4 py-2 text-[10px] uppercase tracking-[0.14em] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejecting(app);
                            setRejectNote("");
                          }}
                          className="inline-flex items-center gap-1.5 border border-stone-300 px-3 py-2 text-[10px] uppercase tracking-[0.14em] font-bold text-stone-600 hover:border-red-400 hover:text-red-700 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t border-stone-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-stone-400">
                      Trade pricing applies to
                    </p>
                    <p className="text-[11px] text-stone-500">
                      Requested: {app.departmentsLabel}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAllDepartments(app)}
                      className={`px-2.5 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold border transition-colors ${
                        scope.size === 0
                          ? "border-stone-800 bg-stone-800 text-white"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      }`}
                    >
                      All departments
                    </button>
                    {departments.map((dept) => {
                      const on = scope.has(dept.slug);
                      return (
                        <button
                          key={dept.slug}
                          type="button"
                          onClick={() => toggleScope(app, dept.slug)}
                          className={`px-2.5 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold border transition-colors ${
                            on
                              ? "border-stone-800 bg-stone-800 text-white"
                              : "border-stone-200 text-stone-500 hover:border-stone-400"
                          }`}
                        >
                          {dept.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-stone-400">
                    {scope.size === 0
                      ? "Every department in the catalogue."
                      : `${scope.size} department${scope.size === 1 ? "" : "s"} — everything else stays at retail price.`}
                  </p>
                </div>

                {app.status === "rejected" && app.reviewNote ? (
                  <p className="mt-3 border-t border-stone-100 pt-3 text-[11px] text-stone-500">
                    Note sent: {app.reviewNote}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {rejecting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Dismiss"
            className="absolute inset-0 bg-black/40"
            onClick={() => setRejecting(null)}
          />
          <div className="relative w-full max-w-md bg-white p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-stone-800">
              Decline {rejecting.companyName || rejecting.name}?
            </h3>
            <p className="mt-2 text-xs text-stone-500">
              They will be emailed. Anything you write below is included in that
              email — leave it blank to send the standard wording.
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={4}
              placeholder="Optional note to the applicant"
              className="mt-4 w-full border border-stone-300 p-3 text-sm outline-none focus:border-stone-600"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejecting(null)}
                className="px-4 py-2 text-[10px] uppercase tracking-[0.14em] font-bold text-stone-500 hover:text-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === rejecting.id}
                onClick={handleReject}
                className="inline-flex items-center gap-1.5 bg-red-600 px-4 py-2 text-[10px] uppercase tracking-[0.14em] font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busyId === rejecting.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Decline and email
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
