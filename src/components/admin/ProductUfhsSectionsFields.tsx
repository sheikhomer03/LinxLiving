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
  if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
  return String(json.url);
}

function ImageUpload({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          className="w-12 h-12 rounded-md object-cover border border-stone-200"
        />
      ) : (
        <div className="w-12 h-12 rounded-md bg-stone-100 border border-dashed border-stone-300" />
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
            if (!file) return;
            setUploading(true);
            try {
              onChange(await uploadFile(file));
            } finally {
              setUploading(false);
              e.target.value = "";
            }
          }}
        />
      </label>
    </div>
  );
}

/**
 * Admin: Coverage, nested options (image/text), Do the Job Right tools.
 */
export function ProductUfhsSectionsFields({
  control,
  register,
  setValue,
}: Props) {
  const coverageValues = useFieldArray({
    control,
    name: "coverage.values",
  });
  const nestedFields = useFieldArray({
    control,
    name: "nestedOptions",
  });
  const jobItems = useFieldArray({
    control,
    name: "doTheJobRight.items",
  });

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-stone-200 bg-[#fafafa] p-5 space-y-4">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.16em] font-bold text-stone-700">
            Coverage
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            Area / size coverage options (e.g. 1.0m² … 30.0m²). Used by Underfloor
            Heating Store–style kits.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
              Label
            </span>
            <input
              className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              {...register("coverage.label")}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
              Help text
            </span>
            <input
              className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              {...register("coverage.helptext")}
            />
          </label>
        </div>
        <div className="space-y-3">
          {coverageValues.fields.map((field, index) => (
            <div
              key={field.id}
              className="rounded-lg border border-stone-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
            >
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
                  Value
                </span>
                <input
                  className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
                  placeholder="e.g. 5.0m2"
                  {...register(`coverage.values.${index}.name`)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
                  Price adj.
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
                  {...register(`coverage.values.${index}.priceAdjustment`, {
                    valueAsNumber: true,
                  })}
                />
              </label>
              <button
                type="button"
                onClick={() => coverageValues.remove(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-md"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <div className="sm:col-span-3">
                <ImageUpload
                  value={
                    useWatch({
                      control,
                      name: `coverage.values.${index}.imageUrl`,
                    }) || ""
                  }
                  onChange={(url) =>
                    setValue(`coverage.values.${index}.imageUrl`, url, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              coverageValues.append({
                name: "",
                imageUrl: "",
                priceAdjustment: 0,
                sku: "",
                sortOrder: coverageValues.fields.length,
              })
            }
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-primary"
          >
            <Plus className="w-4 h-4" /> Add coverage value
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-[#fafafa] p-5 space-y-4">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.16em] font-bold text-stone-700">
            Nested options
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            Option groups with image and/or text choices. Each choice can carry
            nested child options (JSON) for deep trees from suppliers.
          </p>
        </div>
        {nestedFields.fields.map((field, index) => (
          <NestedOptionEditor
            key={field.id}
            index={index}
            control={control}
            register={register}
            setValue={setValue}
            onRemove={() => nestedFields.remove(index)}
          />
        ))}
        <button
          type="button"
          onClick={() =>
            nestedFields.append({
              id: `field-${Date.now()}`,
              label: "",
              helptext: "",
              type: "image-swatches",
              required: false,
              sortOrder: nestedFields.fields.length,
              choices: [],
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-primary"
        >
          <Plus className="w-4 h-4" /> Add option group
        </button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-[#fafafa] p-5 space-y-4">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.16em] font-bold text-stone-700">
            Do the Job Right — Tools and Testing Equipment
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            Optional install tools / testers offered beside the main product.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
              Label
            </span>
            <input
              className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              {...register("doTheJobRight.label")}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
              Help text
            </span>
            <textarea
              rows={2}
              className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              {...register("doTheJobRight.helptext")}
            />
          </label>
        </div>
        {jobItems.fields.map((field, index) => (
          <div
            key={field.id}
            className="rounded-lg border border-stone-200 bg-white p-3 space-y-3"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  className="rounded-md border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Tool name"
                  {...register(`doTheJobRight.items.${index}.name`)}
                />
                <input
                  type="number"
                  step="0.01"
                  className="rounded-md border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Price adj."
                  {...register(`doTheJobRight.items.${index}.priceAdjustment`, {
                    valueAsNumber: true,
                  })}
                />
                <input
                  className="sm:col-span-2 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Description"
                  {...register(`doTheJobRight.items.${index}.description`)}
                />
              </div>
              <button
                type="button"
                onClick={() => jobItems.remove(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-md"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <ImageUpload
              value={
                useWatch({
                  control,
                  name: `doTheJobRight.items.${index}.imageUrl`,
                }) || ""
              }
              onChange={(url) =>
                setValue(`doTheJobRight.items.${index}.imageUrl`, url, {
                  shouldDirty: true,
                })
              }
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            jobItems.append({
              name: "",
              imageUrl: "",
              priceAdjustment: 0,
              description: "",
              sortOrder: jobItems.fields.length,
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-primary"
        >
          <Plus className="w-4 h-4" /> Add tool / tester
        </button>
      </section>
    </div>
  );
}

function NestedOptionEditor({
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
  const choices = useFieldArray({
    control,
    name: `nestedOptions.${index}.choices`,
  });
  const prefix = `nestedOptions.${index}` as const;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="rounded-md border border-stone-200 px-3 py-2 text-sm"
            placeholder="Group label"
            {...register(`${prefix}.label`)}
          />
          <select
            className="rounded-md border border-stone-200 px-3 py-2 text-sm"
            {...register(`${prefix}.type`)}
          >
            <option value="image-swatches">Image swatches</option>
            <option value="buttons">Text buttons</option>
            <option value="select">Select / dropdown</option>
            <option value="radio">Radio</option>
            <option value="switch">Switch</option>
            <option value="text">Text</option>
            <option value="group">Group</option>
          </select>
          <input
            className="sm:col-span-2 rounded-md border border-stone-200 px-3 py-2 text-sm"
            placeholder="Help text"
            {...register(`${prefix}.helptext`)}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 pl-2 border-l-2 border-stone-100">
        {choices.fields.map((c, ci) => (
          <div
            key={c.id}
            className="rounded-md border border-stone-100 p-3 space-y-2"
          >
            <div className="flex gap-2 items-start">
              <input
                className="flex-1 rounded-md border border-stone-200 px-3 py-2 text-sm"
                placeholder="Choice label"
                {...register(`${prefix}.choices.${ci}.label`)}
              />
              <input
                type="number"
                step="0.01"
                className="w-28 rounded-md border border-stone-200 px-3 py-2 text-sm"
                placeholder="+£"
                {...register(`${prefix}.choices.${ci}.priceAdjustment`, {
                  valueAsNumber: true,
                })}
              />
              <button
                type="button"
                onClick={() => choices.remove(ci)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-md"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <ImageUpload
              value={
                useWatch({
                  control,
                  name: `${prefix}.choices.${ci}.imageUrl`,
                }) || ""
              }
              onChange={(url) =>
                setValue(`${prefix}.choices.${ci}.imageUrl`, url, {
                  shouldDirty: true,
                })
              }
            />
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
                Nested options JSON (optional)
              </span>
              <textarea
                rows={3}
                className="w-full rounded-md border border-stone-200 px-3 py-2 text-xs font-mono"
                placeholder='[{"label":"Child","type":"buttons","choices":[{"label":"A"}]}]'
                defaultValue={JSON.stringify(
                  useWatch({
                    control,
                    name: `${prefix}.choices.${ci}.nested`,
                  }) || [],
                )}
                onBlur={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value || "[]");
                    setValue(`${prefix}.choices.${ci}.nested`, parsed, {
                      shouldDirty: true,
                    });
                  } catch {
                    /* keep previous */
                  }
                }}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            choices.append({
              label: "",
              value: "",
              imageUrl: "",
              priceAdjustment: 0,
              helptext: "",
              nested: [],
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-primary"
        >
          <Plus className="w-3.5 h-3.5" /> Add choice
        </button>
      </div>
    </div>
  );
}
