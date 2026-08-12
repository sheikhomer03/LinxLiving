"use client";

import { useState } from "react";
import {
  useFieldArray,
  useWatch,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { Check, FileText, Plus, Trash2, Upload } from "lucide-react";

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
};

async function uploadAsset(
  file: File,
  folder: string,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
  return String(json.url);
}

/**
 * Otto Tiles–style product sections for admin create/edit.
 * Installation guides are intentionally separate from Downloads / Files Documentation.
 */
export function ProductOttoSectionsFields({
  control,
  register,
  setValue,
}: Props) {
  const {
    fields: guideFields,
    append: appendGuide,
    remove: removeGuide,
  } = useFieldArray({ control, name: "installationMaintenanceGuides" });

  const {
    fields: usageFields,
    append: appendUsage,
    remove: removeUsage,
  } = useFieldArray({ control, name: "usage" });

  return (
    <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8">
      <div className="space-y-1">
        <h2 className="text-xl font-serif text-primary font-bold lowercase">
          Product detail sections
        </h2>
        <p className="text-[10px] uppercase tracking-widest opacity-80">
          Shown under the Product Description tab (Otto-style). Usage also
          renders as a separate Explore block on the product page.
        </p>
      </div>

      {(
        [
          ["delivery", "Delivery"],
          ["howItsMade", "How It's Made"],
          ["productAndSampleOrders", "Product and Sample Orders"],
        ] as const
      ).map(([name, label]) => (
        <div key={name} className="space-y-2">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            {label}
          </label>
          <textarea
            rows={5}
            placeholder={`${label} content…`}
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400 min-h-[100px]"
            {...register(name)}
          />
        </div>
      ))}

      <div className="space-y-3 border-t border-stone-100 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-primary">
              Download Installation &amp; Maintenance Guides
            </h3>
            <p className="text-[10px] uppercase tracking-widest opacity-70 mt-1">
              Separate from Downloads and Files Documentation
            </p>
          </div>
          <button
            type="button"
            onClick={() => appendGuide({ name: "", url: "" })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold hover:bg-stone-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add guide
          </button>
        </div>

        {guideFields.length === 0 ? (
          <p className="text-xs text-stone-500">No installation guides yet.</p>
        ) : null}

        <div className="space-y-3">
          {guideFields.map((field, index) => (
            <GuideRow
              key={field.id}
              index={index}
              control={control}
              register={register}
              setValue={setValue}
              onRemove={() => removeGuide(index)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-stone-100 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-primary">
              Usage
            </h3>
            <p className="text-[10px] uppercase tracking-widest opacity-70 mt-1">
              Upload an image per use-case. Checked items show a tick on the
              storefront (and power the Explore section).
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              appendUsage({ title: "", image: "", checked: true })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold hover:bg-stone-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add usage
          </button>
        </div>

        {usageFields.length === 0 ? (
          <p className="text-xs text-stone-500">No usage items yet.</p>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {usageFields.map((field, index) => (
            <UsageRow
              key={field.id}
              index={index}
              control={control}
              register={register}
              setValue={setValue}
              onRemove={() => removeUsage(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function GuideRow({
  index,
  control,
  register,
  setValue,
  onRemove,
}: {
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const prefix = `installationMaintenanceGuides.${index}` as const;
  const url = useWatch({ control, name: `${prefix}.url` }) || "";

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-end rounded-md border border-stone-100 bg-stone-50/50 p-3">
      <div className="flex-1 space-y-1">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          Guide name
        </label>
        <input
          type="text"
          placeholder="e.g. Zellige & Bejmat Installation Guide"
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400 bg-white"
          {...register(`${prefix}.name`)}
        />
      </div>
      <div className="flex items-center gap-2">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline"
          >
            <FileText className="w-3.5 h-3.5" />
            View
          </a>
        ) : null}
        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold cursor-pointer hover:bg-white bg-white">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "…" : "PDF"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setUploading(true);
              try {
                const uploaded = await uploadAsset(
                  file,
                  "ecommerce-pro/products/installation-maintenance-guides",
                );
                setValue(`${prefix}.url`, uploaded, { shouldDirty: true });
                setValue(
                  `${prefix}.name`,
                  file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
                  { shouldDirty: true },
                );
              } catch (err: any) {
                alert(err?.message || "Upload failed");
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-stone-400 hover:text-red-600"
          aria-label="Remove guide"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <input type="hidden" {...register(`${prefix}.url`)} />
    </div>
  );
}

function UsageRow({
  index,
  control,
  register,
  setValue,
  onRemove,
}: {
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const prefix = `usage.${index}` as const;
  const image = useWatch({ control, name: `${prefix}.image` }) || "";
  const checked = Boolean(useWatch({ control, name: `${prefix}.checked` }));

  return (
    <div className="rounded-md border border-stone-100 bg-stone-50/50 p-3 space-y-3">
      <div className="flex gap-3">
        <div className="w-16 h-16 shrink-0 border border-stone-200 bg-white flex items-center justify-center overflow-hidden relative">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="w-full h-full object-contain p-1" />
          ) : (
            <span className="text-[9px] uppercase text-stone-400">No img</span>
          )}
          {checked && image ? (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
              <Check className="w-3 h-3" strokeWidth={3} />
            </span>
          ) : null}
        </div>
        <div className="flex-1 space-y-2">
          <input
            type="text"
            placeholder="e.g. Floors"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400 bg-white"
            {...register(`${prefix}.title`)}
          />
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-stone-300"
              checked={checked}
              onChange={(e) =>
                setValue(`${prefix}.checked`, e.target.checked, {
                  shouldDirty: true,
                })
              }
            />
            Show tick icon
          </label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold cursor-pointer hover:bg-white bg-white">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "…" : image ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/*,.svg"
            className="hidden"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setUploading(true);
              try {
                const uploaded = await uploadAsset(
                  file,
                  "ecommerce-pro/products/usage",
                );
                setValue(`${prefix}.image`, uploaded, { shouldDirty: true });
              } catch (err: any) {
                alert(err?.message || "Upload failed");
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-stone-400 hover:text-red-600 ml-auto"
          aria-label="Remove usage"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <input type="hidden" {...register(`${prefix}.image`)} />
    </div>
  );
}
