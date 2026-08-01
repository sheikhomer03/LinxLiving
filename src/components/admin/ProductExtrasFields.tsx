"use client";

import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

/** Minimal shape shared by admin create/edit product forms. */
export type ProductExtrasFormSlice = {
  installationGuide?: string;
  insulatingSetPrice?: number | null;
  flashingFinder: {
    title: string;
    description?: string;
    imageUrl?: string;
  }[];
  finishes: {
    name: string;
    imageUrl?: string;
    priceAdjustment?: number;
  }[];
  flashings: {
    name: string;
    imageUrl?: string;
    priceAdjustment?: number;
  }[];
};

type Props = {
  // Shared across create/edit schemas — RHF Control generics don't interop cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
};

/**
 * Optional Linx Glass–style product extras for admin create/edit.
 */
export function ProductExtrasFields({ control, register }: Props) {
  const finder = useFieldArray({ control, name: "flashingFinder" });
  const finishes = useFieldArray({ control, name: "finishes" });
  const flashings = useFieldArray({ control, name: "flashings" });

  return (
    <div className="space-y-8 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div>
        <h3 className="text-sm font-semibold text-stone-900">
          Installation &amp; options
        </h3>
        <p className="mt-1 text-xs text-stone-500">
          Optional — matches Linx Glass. Synced to Shopify as{" "}
          <code className="text-[10px]">linx</code> metafields.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-stone-600">
          Installation guide
        </label>
        <textarea
          rows={4}
          placeholder="Measuring tips, install notes…"
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400"
          {...register("installationGuide")}
        />
      </div>

      <div className="space-y-2 max-w-xs">
        <label className="text-xs font-medium uppercase tracking-wide text-stone-600">
          Insulating set price (ex. VAT)
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Leave empty if not offered"
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400"
          {...register("insulatingSetPrice", {
            setValueAs: (v) =>
              v === "" || v === null || v === undefined ? null : Number(v),
          })}
        />
        <p className="text-[11px] text-stone-450 text-stone-500">
          Empty = not shown on the product page.
        </p>
      </div>

      <OptionListEditor
        title="Finishes"
        hint="Optional finish options with price adjustment"
        fields={finishes.fields}
        onAdd={() =>
          finishes.append({ name: "", imageUrl: "", priceAdjustment: 0 })
        }
        onRemove={finishes.remove}
        register={register}
        namePrefix="finishes"
      />

      <OptionListEditor
        title="Flashings"
        hint="Optional flashing kits with price adjustment"
        fields={flashings.fields}
        onAdd={() =>
          flashings.append({ name: "", imageUrl: "", priceAdjustment: 0 })
        }
        onRemove={flashings.remove}
        register={register}
        namePrefix="flashings"
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-stone-800">
              Flashing Finder
            </h4>
            <p className="text-[11px] text-stone-500">
              Informational cards (not add-to-cart options)
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              finder.append({ title: "", description: "", imageUrl: "" })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-stone-100"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {finder.fields.length === 0 ? (
          <p className="text-xs text-stone-400">No flashing finder items.</p>
        ) : (
          <div className="space-y-3">
            {finder.fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <input
                  placeholder="Title"
                  className="rounded border border-stone-200 px-2 py-1.5 text-sm"
                  {...register(`flashingFinder.${index}.title`)}
                />
                <input
                  placeholder="Image URL"
                  className="rounded border border-stone-200 px-2 py-1.5 text-sm"
                  {...register(`flashingFinder.${index}.imageUrl`)}
                />
                <button
                  type="button"
                  onClick={() => finder.remove(index)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded border border-stone-200 text-stone-500 hover:bg-stone-50"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <textarea
                  rows={2}
                  placeholder="Description"
                  className="sm:col-span-3 rounded border border-stone-200 px-2 py-1.5 text-sm"
                  {...register(`flashingFinder.${index}.description`)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionListEditor({
  title,
  hint,
  fields,
  onAdd,
  onRemove,
  register,
  namePrefix,
}: {
  title: string;
  hint: string;
  fields: { id: string }[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  register: UseFormRegister<any>;
  namePrefix: "finishes" | "flashings";
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-stone-800">{title}</h4>
          <p className="text-[11px] text-stone-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-stone-100"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-stone-400">None added.</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-[1.2fr_1fr_0.7fr_auto]"
            >
              <input
                placeholder="Name"
                className="rounded border border-stone-200 px-2 py-1.5 text-sm"
                {...register(`${namePrefix}.${index}.name`)}
              />
              <input
                placeholder="Image URL"
                className="rounded border border-stone-200 px-2 py-1.5 text-sm"
                {...register(`${namePrefix}.${index}.imageUrl`)}
              />
              <input
                type="number"
                step="0.01"
                placeholder="+ £"
                className="rounded border border-stone-200 px-2 py-1.5 text-sm"
                {...register(`${namePrefix}.${index}.priceAdjustment`, {
                  valueAsNumber: true,
                })}
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="inline-flex h-9 w-9 items-center justify-center rounded border border-stone-200 text-stone-500 hover:bg-stone-50"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
