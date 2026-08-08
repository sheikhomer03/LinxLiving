"use client";

import { useState } from "react";
import {
  useFieldArray,
  useWatch,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { Plus, Trash2, Upload } from "lucide-react";

const GRADIENT_PRESETS = [
  "linear-gradient(135deg, #d4d4d4 0%, #737373 100%)",
  "linear-gradient(135deg, #f5e6c8 0%, #c9a227 100%)",
  "linear-gradient(135deg, #e8e8e8 0%, #1a1a1a 100%)",
  "linear-gradient(135deg, #f0e6d2 0%, #8b7355 100%)",
  "linear-gradient(135deg, #c0c0c0 0%, #4a4a4a 50%, #c0c0c0 100%)",
  "linear-gradient(135deg, #fff8e7 0%, #b8860b 100%)",
];

type Props = {
  // RHF Control<T> is not assignable to Control<any> (validate name variance).
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

function ColorRow({
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
  const [uploading, setUploading] = useState<"image" | "swatch" | null>(null);
  const prefix = `colorOptions.${index}` as const;
  const swatchType =
    useWatch({ control, name: `${prefix}.swatchType` }) || "solid";
  const colorValue = useWatch({ control, name: `${prefix}.colorValue` }) || "";
  const imageUrl = useWatch({ control, name: `${prefix}.imageUrl` }) || "";
  const swatchImage =
    useWatch({ control, name: `${prefix}.swatchImage` }) || "";

  const solidHex = /^#[0-9a-fA-F]{6}$/.test(colorValue)
    ? colorValue
    : "#cccccc";

  const gradientMatch = String(colorValue).match(
    /linear-gradient\([^,]+,\s*(#[0-9a-fA-F]{3,8})\s+0%?,\s*(#[0-9a-fA-F]{3,8})/i,
  );
  const gradFrom = gradientMatch?.[1] || "#e5e5e5";
  const gradTo = gradientMatch?.[2] || "#737373";

  const previewStyle =
    swatchType === "gradient"
      ? { background: colorValue || GRADIENT_PRESETS[0] }
      : swatchType === "image" && swatchImage
        ? {
            backgroundImage: `url(${swatchImage})`,
            backgroundSize: "cover" as const,
            backgroundPosition: "center" as const,
          }
        : { background: solidHex };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="w-10 h-10 rounded-full border border-stone-300 shrink-0 shadow-inner"
            style={previewStyle}
            title="Swatch preview"
          />
          <div className="flex-1 min-w-0 space-y-1">
            <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
              Colour name
            </label>
            <input
              type="text"
              placeholder="e.g. Matt black"
              className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
              {...register(`${prefix}.name`)}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
          aria-label="Remove colour"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["solid", "gradient"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              setValue(`${prefix}.swatchType`, type, { shouldDirty: true });
              if (type === "solid" && !/^#/.test(colorValue)) {
                setValue(`${prefix}.colorValue`, "#cccccc", {
                  shouldDirty: true,
                });
              }
              if (type === "gradient" && !/gradient/i.test(colorValue)) {
                setValue(`${prefix}.colorValue`, GRADIENT_PRESETS[0], {
                  shouldDirty: true,
                });
              }
            }}
            className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-wider font-bold border transition-colors ${
              swatchType === type
                ? "border-foreground bg-foreground text-background"
                : "border-stone-200 text-stone-600 hover:border-stone-400"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {swatchType === "solid" ? (
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={solidHex}
            onChange={(e) =>
              setValue(`${prefix}.colorValue`, e.target.value, {
                shouldDirty: true,
              })
            }
            className="w-12 h-10 rounded border border-stone-200 cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={colorValue}
            onChange={(e) =>
              setValue(`${prefix}.colorValue`, e.target.value, {
                shouldDirty: true,
              })
            }
            placeholder="#000000"
            className="flex-1 rounded-md border border-stone-200 px-3 py-2 text-sm font-mono outline-none focus:border-stone-400"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-stone-500">
                From
              </span>
              <input
                type="color"
                value={gradFrom}
                onChange={(e) =>
                  setValue(
                    `${prefix}.colorValue`,
                    `linear-gradient(135deg, ${e.target.value} 0%, ${gradTo} 100%)`,
                    { shouldDirty: true },
                  )
                }
                className="w-10 h-9 rounded border border-stone-200 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-stone-500">
                To
              </span>
              <input
                type="color"
                value={gradTo}
                onChange={(e) =>
                  setValue(
                    `${prefix}.colorValue`,
                    `linear-gradient(135deg, ${gradFrom} 0%, ${e.target.value} 100%)`,
                    { shouldDirty: true },
                  )
                }
                className="w-10 h-9 rounded border border-stone-200 cursor-pointer"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {GRADIENT_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                title={g}
                onClick={() =>
                  setValue(`${prefix}.colorValue`, g, { shouldDirty: true })
                }
                className="w-8 h-8 rounded-full border border-stone-300 shadow-inner"
                style={{ background: g }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Product image for this colour
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
              {uploading === "image" ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!!uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading("image");
                  try {
                    const url = await uploadFile(file);
                    setValue(`${prefix}.imageUrl`, url, { shouldDirty: true });
                  } catch (err) {
                    console.error(err);
                    alert(
                      err instanceof Error ? err.message : "Upload failed",
                    );
                  } finally {
                    setUploading(null);
                  }
                }}
              />
            </label>
          </div>
          <input type="hidden" {...register(`${prefix}.imageUrl`)} />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Swatch image (optional)
          </label>
          <div className="flex items-center gap-3">
            {swatchImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={swatchImage}
                alt=""
                className="w-10 h-10 rounded-full object-cover border border-stone-200"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-stone-100 border border-dashed border-stone-300" />
            )}
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold cursor-pointer hover:bg-stone-50">
              <Upload className="w-3.5 h-3.5" />
              {uploading === "swatch" ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!!uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading("swatch");
                  try {
                    const url = await uploadFile(file);
                    setValue(`${prefix}.swatchImage`, url, {
                      shouldDirty: true,
                    });
                    setValue(`${prefix}.swatchType`, "image", {
                      shouldDirty: true,
                    });
                  } catch (err) {
                    console.error(err);
                    alert(
                      err instanceof Error ? err.message : "Upload failed",
                    );
                  } finally {
                    setUploading(null);
                  }
                }}
              />
            </label>
          </div>
          <input type="hidden" {...register(`${prefix}.swatchImage`)} />
          <input type="hidden" {...register(`${prefix}.swatchType`)} />
          <input type="hidden" {...register(`${prefix}.colorValue`)} />
          <input type="hidden" {...register(`${prefix}.sap`)} />
          <input type="hidden" {...register(`${prefix}.sortOrder`)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Optional admin colour variants: name, solid/gradient picker, product image.
 */
export function ProductColorFields({ control, register, setValue }: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "colorOptions",
  });

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Colours</h3>
          <p className="mt-1 text-xs text-stone-500">
            Optional — add colour swatches with a product image for each finish.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            append({
              name: "",
              swatchType: "solid",
              colorValue: "#cccccc",
              swatchImage: "",
              imageUrl: "",
              sap: "",
              sortOrder: fields.length,
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Colours
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-stone-450 text-stone-500">
          No colours added. Click Add Colours to create optional variants.
        </p>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <ColorRow
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
