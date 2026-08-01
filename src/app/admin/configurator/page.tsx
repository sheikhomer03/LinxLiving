"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Sprout } from "lucide-react";
import { toast } from "sonner";
import {
  ensureConfiguratorDepartmentsEnabled,
  getAdminConfiguratorDepartments,
  setDepartmentConfiguratorVisibility,
} from "@/app/actions/configuratorCategories";

type Dept = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  order?: number;
  isActive?: boolean;
  showInConfigurator?: boolean;
  productCount?: number;
};

export default function AdminConfiguratorPage() {
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    const res = await getAdminConfiguratorDepartments();
    setDepartments(res.departments || []);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const onEnableDefaults = async () => {
    setIsSeeding(true);
    const res = await ensureConfiguratorDepartmentsEnabled();
    setIsSeeding(false);
    if (!res.success) {
      toast.error(res.error || "Failed");
      return;
    }
    toast.success(
      `Enabled Windows & Doors / Rooflights (${res.modified ?? 0} updated)`,
    );
    load();
  };

  const onToggle = async (dept: Dept) => {
    const next = !dept.showInConfigurator;
    setTogglingId(dept._id);
    setDepartments((prev) =>
      prev.map((d) =>
        d._id === dept._id ? { ...d, showInConfigurator: next } : d,
      ),
    );
    const res = await setDepartmentConfiguratorVisibility(dept._id, next);
    setTogglingId(null);
    if (!res.success) {
      setDepartments((prev) =>
        prev.map((d) =>
          d._id === dept._id
            ? { ...d, showInConfigurator: dept.showInConfigurator }
            : d,
        ),
      );
      toast.error(res.error || "Update failed");
      return;
    }
    toast.success(
      next
        ? `Showing “${dept.name}” on Configurator`
        : `Hidden “${dept.name}” from Configurator`,
    );
    load();
  };

  const enabled = departments.filter((d) => d.showInConfigurator);

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif tracking-wide">Configurator</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Hub cards are your real Departments. Products come from the live
            catalogue. Changing size/options on a product uses that product’s
            real prices (sibling size SKUs, variants, finishes).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEnableDefaults}
            disabled={isSeeding}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-foreground/15 text-[10px] uppercase tracking-[0.18em] font-bold disabled:opacity-50"
          >
            {isSeeding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sprout className="w-3.5 h-3.5" />
            )}
            Enable Windows & Doors
          </button>
          <Link
            href="/admin/menus"
            className="inline-flex items-center justify-center px-4 py-2.5 border border-foreground/15 text-[10px] uppercase tracking-[0.18em] font-bold"
          >
            Map menus → department
          </Link>
          <Link
            href="/configurator"
            target="_blank"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-foreground text-background text-[10px] uppercase tracking-[0.18em] font-bold"
          >
            Open storefront
          </Link>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Currently on hub:{" "}
        {enabled.length ? enabled.map((d) => d.name).join(", ") : "none"}
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : departments.length === 0 ? (
        <div className="border border-dashed border-foreground/15 p-10 text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            No departments yet. Seed them from Admin → Departments first.
          </p>
          <Link
            href="/admin/departments"
            className="inline-flex px-4 py-2.5 bg-foreground text-background text-[10px] uppercase tracking-[0.18em] font-bold"
          >
            Go to Departments
          </Link>
        </div>
      ) : (
        <div className="border border-foreground/10 divide-y divide-foreground/8 bg-white">
          {departments.map((dept) => (
            <div
              key={dept._id}
              className="flex flex-col md:flex-row md:items-center gap-4 p-5"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-sm tracking-wide">
                    {dept.name}
                  </h3>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {dept.slug}
                  </span>
                </div>
                {dept.description ? (
                  <p className="text-xs text-muted-foreground">
                    {dept.description}
                  </p>
                ) : null}
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {dept.productCount ?? 0} live product
                  {(dept.productCount ?? 0) === 1 ? "" : "s"}
                  {(dept.productCount ?? 0) === 0
                    ? " · hidden on hub until products exist"
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggle(dept)}
                disabled={togglingId === dept._id}
                className={`shrink-0 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] font-bold border disabled:opacity-50 ${
                  dept.showInConfigurator
                    ? "bg-foreground text-background border-foreground"
                    : "border-foreground/15"
                }`}
              >
                {togglingId === dept._id
                  ? "…"
                  : dept.showInConfigurator
                    ? "On hub"
                    : "Show on hub"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
