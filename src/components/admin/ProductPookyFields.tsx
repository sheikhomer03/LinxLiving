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

type FieldName = "bases" | "shades" | "pendants" | "wallFittings";

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
  return String(json.url);
}

function OptionRow({
  fieldName,
  index,
  control,
  register,
  setValue,
  onRemove,
  label,
}: {
  fieldName: FieldName;
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  onRemove: () => void;
  label: string;
}) {
  const [uploading, setUploading] = useState(false);
  const prefix = `${fieldName}.${index}` as const;
  const images =
    (useWatch({ control, name: `${prefix}.images` }) as string[]) || [];

  const setImages = (next: string[]) => {
    setValue(`${prefix}.images`, next, { shouldDirty: true });
  };

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            {label} name
          </label>
          <input
            type="text"
            placeholder={`e.g. ${label}`}
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
            {...register(`${prefix}.name`)}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
          aria-label={`Remove ${label}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Price (£)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
            {...register(`${prefix}.price`, { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Stock
          </label>
          <input
            type="number"
            step="1"
            min="0"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
            {...register(`${prefix}.stock`, { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          Images
        </label>
        <div className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={`${url}-${i}`} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-16 w-16 object-cover rounded border border-stone-200"
              />
              <button
                type="button"
                onClick={() => setImages(images.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-[10px]"
              >
                ×
              </button>
            </div>
          ))}
          <label className="h-16 w-16 rounded border border-dashed border-stone-300 flex items-center justify-center cursor-pointer hover:bg-stone-50">
            <Upload className="w-4 h-4 text-stone-400" />
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
                  setImages([...images, url]);
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </div>
        <input type="hidden" {...register(`${prefix}.handle`)} />
        <input type="hidden" {...register(`${prefix}.sku`)} />
        <input
          type="hidden"
          {...register(`${prefix}.sortOrder`, { valueAsNumber: true })}
        />
      </div>
    </div>
  );
}

function OptionSection({
  title,
  hint,
  fieldName,
  addLabel,
  itemLabel,
  control,
  register,
  setValue,
}: {
  title: string;
  hint: string;
  fieldName: FieldName;
  addLabel: string;
  itemLabel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: fieldName,
  });

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
          <p className="mt-1 text-xs text-stone-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            append({
              name: "",
              images: [],
              price: 0,
              stock: 0,
              handle: "",
              sku: "",
              sortOrder: fields.length,
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-stone-500">
          None added yet. Click {addLabel} to create options.
        </p>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <OptionRow
              key={field.id}
              fieldName={fieldName}
              index={index}
              control={control}
              register={register}
              setValue={setValue}
              onRemove={() => remove(index)}
              label={itemLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Admin: Bases / Shades / Pendants / Wall Fittings / Efficiency (Pooky).
 */
export function ProductPookyFields({ control, register, setValue }: Props) {
  return (
    <section className="space-y-5">
      <div className="space-y-1 px-1">
        <h2 className="text-xl font-serif text-primary font-bold lowercase">
          Pooky options
        </h2>
        <p className="text-[10px] uppercase tracking-widest opacity-80">
          Base, shade, pendant and wall fitting selectors for lighting products.
        </p>
      </div>

      <OptionSection
        title="Bases"
        hint="Lamp bases — name, images, price and stock."
        fieldName="bases"
        addLabel="Add Base"
        itemLabel="Base"
        control={control}
        register={register}
        setValue={setValue}
      />

      <OptionSection
        title="Shades"
        hint="Lamp shades — name, images, price and stock."
        fieldName="shades"
        addLabel="Add Shades"
        itemLabel="Shade"
        control={control}
        register={register}
        setValue={setValue}
      />

      <OptionSection
        title="Pendants"
        hint="Pendant shades — shown in the pendant tab next to shades."
        fieldName="pendants"
        addLabel="Add Pendant"
        itemLabel="Pendant"
        control={control}
        register={register}
        setValue={setValue}
      />

      <OptionSection
        title="Wall fittings"
        hint="Wall fittings — shown on the product detail page."
        fieldName="wallFittings"
        addLabel="Add Wall Fitting"
        itemLabel="Wall fitting"
        control={control}
        register={register}
        setValue={setValue}
      />

      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Efficiency</h3>
          <p className="mt-1 text-xs text-stone-500">
            Efficiency details shown on the product page (Pooky-style tab).
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Summary / rating
          </label>
          <input
            type="text"
            placeholder="e.g. LED compatible · A++"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400 bg-white"
            {...register("efficiency.summary")}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Efficiency details
          </label>
          <textarea
            rows={5}
            placeholder="Full efficiency details…"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400 bg-white resize-y"
            {...register("efficiency.details")}
          />
        </div>
      </div>
    </section>
  );
}
