"use client";

import { useState } from "react";
import {
  useFieldArray,
  useWatch,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { FileText, Plus, Trash2, Upload } from "lucide-react";

type Props = {
  // RHF Control<T> is not assignable to Control<any> (validate name variance).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
};

async function uploadPdf(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", "ecommerce-pro/products/downloads");
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) {
    throw new Error(json.error || "PDF upload failed");
  }
  return String(json.url);
}

function DownloadRow({
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
  const prefix = `downloads.${index}` as const;
  const url = useWatch({ control, name: `${prefix}.url` }) || "";

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Download name
          </label>
          <input
            type="text"
            placeholder="e.g. Technical sheet"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
            {...register(`${prefix}.name`)}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
          aria-label="Remove download"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          PDF file
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline underline-offset-2"
            >
              <FileText className="w-3.5 h-3.5" />
              View PDF
            </a>
          ) : (
            <span className="text-xs text-stone-400">No file uploaded</span>
          )}
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold cursor-pointer hover:bg-stone-50">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading…" : url ? "Replace PDF" : "Upload PDF"}
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
                  const uploaded = await uploadPdf(file);
                  setValue(`${prefix}.url`, uploaded, { shouldDirty: true });
                  setValue(`${prefix}.type`, "pdf", { shouldDirty: true });
                } catch (err) {
                  console.error(err);
                  alert(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </div>
        <input type="hidden" {...register(`${prefix}.url`)} />
        <input type="hidden" {...register(`${prefix}.type`)} />
        <input type="hidden" {...register(`${prefix}.iconUrl`)} />
      </div>
    </div>
  );
}

/** Optional admin Downloads: name + PDF file. */
export function ProductDownloadFields({ control, register, setValue }: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "downloads",
  });

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Downloads</h3>
          <p className="mt-1 text-xs text-stone-500">
            Optional — add named PDF downloads shown on the product page.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            append({
              name: "",
              url: "",
              type: "pdf",
              iconUrl: "",
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Download
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-stone-500">
          No downloads added. Click Add Download to attach a PDF.
        </p>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <DownloadRow
              key={field.id}
              index={index}
              control={control}
              register={register}
              setValue={setValue}
              onRemove={() => remove(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
