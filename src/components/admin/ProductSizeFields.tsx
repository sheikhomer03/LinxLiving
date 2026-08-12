"use client";

import { useState } from "react";
import {
  useFieldArray,
  useWatch,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
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
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) {
    throw new Error(json.error || "Upload failed");
  }
  return String(json.url);
}

function SizeRow({
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
  const prefix = `sizeOptions.${index}` as const;
  const imageUrl = useWatch({ control, name: `${prefix}.imageUrl` }) || "";

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Size name
          </label>
          <input
            type="text"
            placeholder="e.g. 20 × 20 cm"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
            {...register(`${prefix}.name`)}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
          aria-label="Remove size"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          Size image (optional)
        </label>
        <div className="flex items-center gap-3">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="w-14 h-14 rounded-md object-cover border border-stone-200"
            />
          ) : (
            <div className="w-14 h-14 rounded-md bg-stone-100 border border-dashed border-stone-300" />
          )}
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold cursor-pointer hover:bg-stone-50">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading…" : "Upload"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                try {
                  const url = await uploadFile(file);
                  setValue(`${prefix}.imageUrl`, url, { shouldDirty: true });
                } catch (err) {
                  console.error(err);
                  alert(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {imageUrl ? (
            <button
              type="button"
              onClick={() =>
                setValue(`${prefix}.imageUrl`, "", { shouldDirty: true })
              }
              className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-800"
            >
              Remove image
            </button>
          ) : null}
        </div>
        <input type="hidden" {...register(`${prefix}.imageUrl`)} />
        <input type="hidden" {...register(`${prefix}.sortOrder`)} />
      </div>
    </div>
  );
}

/**
 * Optional admin size variants: name + optional image.
 */
export function ProductSizeFields({ control, register, setValue }: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "sizeOptions",
  });

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Sizes</h3>
          <p className="mt-1 text-xs text-stone-500">
            Optional — add size names with an image for each option.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            append({
              name: "",
              imageUrl: "",
              sortOrder: fields.length,
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Size
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-stone-500">
          No sizes added. Click Add Size to create optional size variants.
        </p>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <SizeRow
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
