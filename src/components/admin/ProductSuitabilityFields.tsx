"use client";

import { useWatch, type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { Plus, Trash2, Upload } from "lucide-react";

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
};

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", "ecommerce-pro/products/suitability");
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
  return String(json.url);
}

/**
 * Admin Suitability editor — choose either a table or an image.
 */
export function ProductSuitabilityFields({
  control,
  register,
  setValue,
}: Props) {
  const type =
    (useWatch({ control, name: "suitability.type" }) as string) || "";
  const image =
    (useWatch({ control, name: "suitability.image" }) as string) || "";
  const headings =
    (useWatch({ control, name: "suitability.tableHeadings" }) as string[]) ||
    [];
  const rows =
    (useWatch({ control, name: "suitability.tableRows" }) as string[][]) || [];

  const setType = (next: "" | "table" | "image") => {
    setValue("suitability.type", next, { shouldDirty: true });
    if (next === "image") {
      setValue("suitability.tableHeadings", [], { shouldDirty: true });
      setValue("suitability.tableRows", [], { shouldDirty: true });
    } else if (next === "table") {
      setValue("suitability.image", "", { shouldDirty: true });
      if (!rows.length) {
        setValue("suitability.tableHeadings", ["Room", "Suitable"], {
          shouldDirty: true,
        });
        setValue("suitability.tableRows", [["", ""]], { shouldDirty: true });
      }
    } else {
      setValue("suitability.image", "", { shouldDirty: true });
      setValue("suitability.tableHeadings", [], { shouldDirty: true });
      setValue("suitability.tableRows", [], { shouldDirty: true });
    }
  };

  const colCount = Math.max(2, headings.length || 2);

  return (
    <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-serif text-primary font-bold lowercase">
          Suitability
        </h2>
        <p className="text-[10px] uppercase tracking-widest opacity-80">
          Optional — add either a table or an image (not both).
        </p>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            ["", "None"],
            ["table", "Table"],
            ["image", "Image"],
          ] as const
        ).map(([value, label]) => (
          <label key={value || "none"} className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="suitability-type"
              checked={type === value}
              onChange={() => setType(value)}
            />
            <span className="text-[11px] uppercase tracking-wide font-bold">
              {label}
            </span>
          </label>
        ))}
      </div>

      {type === "image" ? (
        <div className="space-y-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt="Suitability"
              className="max-h-56 border border-stone-200 object-contain bg-stone-50"
            />
          ) : null}
          <label className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wide font-bold text-stone-700 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            {image ? "Replace image" : "Upload image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const url = await uploadFile(file);
                  setValue("suitability.image", url, { shouldDirty: true });
                  setValue("suitability.type", "image", { shouldDirty: true });
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Upload failed");
                }
              }}
            />
          </label>
          <input type="hidden" {...register("suitability.image")} />
        </div>
      ) : null}

      {type === "table" ? (
        <div className="space-y-3 overflow-x-auto">
          <table className="w-full text-sm border border-stone-200">
            <thead>
              <tr className="bg-stone-50">
                {Array.from({ length: colCount }).map((_, ci) => (
                  <th key={ci} className="p-2 border-b border-stone-200">
                    <input
                      className="w-full rounded border border-stone-200 px-2 py-1.5 text-xs font-bold uppercase"
                      value={headings[ci] || ""}
                      placeholder={`Column ${ci + 1}`}
                      onChange={(e) => {
                        const next = [...headings];
                        while (next.length < colCount) next.push("");
                        next[ci] = e.target.value;
                        setValue("suitability.tableHeadings", next, {
                          shouldDirty: true,
                        });
                      }}
                    />
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {Array.from({ length: colCount }).map((_, ci) => (
                    <td key={ci} className="p-2 border-t border-stone-100">
                      <input
                        className="w-full rounded border border-stone-200 px-2 py-1.5 text-sm"
                        value={row[ci] || ""}
                        onChange={(e) => {
                          const nextRows = rows.map((r) => [...r]);
                          while (nextRows[ri].length < colCount) {
                            nextRows[ri].push("");
                          }
                          nextRows[ri][ci] = e.target.value;
                          setValue("suitability.tableRows", nextRows, {
                            shouldDirty: true,
                          });
                        }}
                      />
                    </td>
                  ))}
                  <td className="p-2 border-t border-stone-100">
                    <button
                      type="button"
                      className="p-1.5 text-red-500"
                      onClick={() => {
                        setValue(
                          "suitability.tableRows",
                          rows.filter((_, i) => i !== ri),
                          { shouldDirty: true },
                        );
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wide font-bold text-primary"
            onClick={() => {
              setValue(
                "suitability.tableRows",
                [...rows, Array.from({ length: colCount }).map(() => "")],
                { shouldDirty: true },
              );
            }}
          >
            <Plus className="w-4 h-4" />
            Add row
          </button>
        </div>
      ) : null}
    </section>
  );
}
