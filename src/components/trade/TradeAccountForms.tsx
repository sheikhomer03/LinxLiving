"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { applyForTradeAccount } from "@/app/actions/trade";
import { TRADE_DISCOUNT_PERCENT } from "@/lib/trade";

export type TradeDepartmentOption = { slug: string; name: string };

const EYEBROW =
  "font-menu text-[9px] font-medium uppercase tracking-[1.4px] text-black/45 lg:text-[10px]";

const FIELD =
  "mt-2 w-full border border-black/20 bg-white px-4 py-3.5 text-sm outline-none transition-colors hover:border-black/40 focus:border-foreground focus:ring-2 focus:ring-foreground/10 disabled:opacity-60";

/**
 * Apply for a trade account, or sign in to one.
 *
 * Two panes behind one pair of tabs rather than two routes: an applicant who
 * has already been approved and a returning customer arrive at the same link
 * from the same email, and splitting them across pages means one of the two
 * always lands on the wrong form.
 *
 * Sign-in is deliberately the same next-auth credentials call the main login
 * uses. The refusal for an unapproved account comes back as the error message
 * thrown in `authorize()`, so the wording lives in one place.
 */
export function TradeAccountForms({
  departments,
}: {
  departments: TradeDepartmentOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"apply" | "signin">("apply");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Trade account"
        className="flex border-b border-black/10"
      >
        {(
          [
            ["apply", "Apply"],
            ["signin", "Sign in"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "-mb-px border-b px-5 py-3 text-[10px] font-medium uppercase tracking-[0.22em] transition-colors",
              tab === value
                ? "border-foreground text-foreground"
                : "border-transparent text-foreground/45 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pt-8">
        {tab === "apply" ? (
          <ApplyForm
            departments={departments}
            onApplied={() => setTab("signin")}
          />
        ) : (
          <SignInForm onSignedIn={() => router.push("/category")} />
        )}
      </div>
    </div>
  );
}

function ApplyForm({
  departments,
  onApplied,
}: {
  departments: TradeDepartmentOption[];
  onApplied: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  /** Empty set means "All departments" — the same convention the server uses. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allDepartments, setAllDepartments] = useState(true);

  const toggleDepartment = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      // Picking any single department is implicitly "not all".
      setAllDepartments(next.size === 0);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== String(form.get("confirmPassword") || "")) {
      setError("The two passwords do not match");
      return;
    }
    if (!allDepartments && selected.size === 0) {
      setError("Choose at least one department, or select All departments");
      return;
    }

    setSubmitting(true);
    const result = await applyForTradeAccount({
      name: String(form.get("name") || ""),
      email: String(form.get("email") || ""),
      password,
      companyName: String(form.get("companyName") || ""),
      phone: String(form.get("phone") || ""),
      departments: allDepartments ? [] : [...selected],
    });
    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setDone(true);
    toast.success("Application received — we will email you once it is reviewed");
  };

  if (done) {
    return (
      <div className="border border-black/10 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center border border-black/15">
          <Check className="h-5 w-5 stroke-[1.5]" />
        </div>
        <h3 className="mt-5 text-base font-medium uppercase tracking-[0.14em]">
          Application received
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-foreground/70">
          Our team will review your account and email you as soon as it is
          approved. You will not be able to sign in until then.
        </p>
        <button
          type="button"
          onClick={onApplied}
          className="mt-6 bg-black px-8 py-3 text-[10px] font-medium uppercase tracking-[0.22em] text-white transition-colors hover:bg-black/85"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="trade-name" className={EYEBROW}>
            Your name *
          </label>
          <input id="trade-name" name="name" required className={FIELD} />
        </div>
        <div>
          <label htmlFor="trade-company" className={EYEBROW}>
            Company
          </label>
          <input id="trade-company" name="companyName" className={FIELD} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="trade-email" className={EYEBROW}>
            Email *
          </label>
          <input
            id="trade-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="trade-phone" className={EYEBROW}>
            Phone
          </label>
          <input
            id="trade-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="trade-password" className={EYEBROW}>
            Password *
          </label>
          <input
            id="trade-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={FIELD}
          />
          <p className="mt-2 text-[11px] text-foreground/50">
            At least 8 characters.
          </p>
        </div>
        <div>
          <label htmlFor="trade-confirm" className={EYEBROW}>
            Confirm password *
          </label>
          <input
            id="trade-confirm"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={FIELD}
          />
        </div>
      </div>

      <fieldset className="border-t border-black/10 pt-6">
        <legend className="sr-only">Departments</legend>
        <p className={EYEBROW}>Trade pricing on</p>
        <p className="mt-2 text-[13px] leading-relaxed text-foreground/70">
          Choose the departments you buy from. Your {TRADE_DISCOUNT_PERCENT}%
          applies to those departments only — pick All departments for the whole
          catalogue.
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={allDepartments}
            onChange={(e) => {
              setAllDepartments(e.target.checked);
              if (e.target.checked) setSelected(new Set());
            }}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-black"
          />
          <span className="text-[13px] font-medium uppercase tracking-[0.1em]">
            All departments
          </span>
        </label>

        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {departments.map((dept) => (
            <label
              key={dept.slug}
              className="flex cursor-pointer items-start gap-3"
            >
              <input
                type="checkbox"
                checked={selected.has(dept.slug)}
                onChange={() => toggleDepartment(dept.slug)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-black"
              />
              <span className="text-[13px] leading-snug text-foreground/80">
                {dept.name}
              </span>
            </label>
          ))}
        </div>
        {!departments.length ? (
          <p className="mt-4 text-[12px] text-foreground/50">
            Department list unavailable — your application will be submitted for
            all departments.
          </p>
        ) : null}
      </fieldset>

      {error ? (
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-3 bg-black px-12 py-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white transition-colors hover:bg-black/85 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          "Apply for a trade account"
        )}
      </button>

      <p className="text-[11px] leading-relaxed text-foreground/50">
        Applications are reviewed by our team. You will be emailed once your
        account is approved, and you cannot sign in before then.
      </p>
    </form>
  );
}

function SignInForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: String(form.get("email") || "").trim(),
      password: String(form.get("password") || ""),
      redirect: false,
    });
    setSubmitting(false);

    if (result?.error) {
      // next-auth surfaces the message thrown by `authorize()`, which is where
      // the "awaiting approval" and "not approved" wording lives.
      setError(result.error);
      return;
    }

    toast.success("Signed in — trade pricing is now applied");
    onSignedIn();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="trade-signin-email" className={EYEBROW}>
          Email
        </label>
        <input
          id="trade-signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="trade-signin-password" className={EYEBROW}>
          Password
        </label>
        <input
          id="trade-signin-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={FIELD}
        />
      </div>

      {error ? (
        <p className="text-[12px] leading-relaxed text-red-600">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-3 bg-black px-12 py-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white transition-colors hover:bg-black/85 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>

      <p className="text-center text-[11px] text-foreground/55">
        Forgotten your password?{" "}
        <Link
          href="/forgot-password"
          className="font-medium text-foreground underline decoration-black/20 underline-offset-4 hover:decoration-foreground"
        >
          Reset it
        </Link>
      </p>
    </form>
  );
}
