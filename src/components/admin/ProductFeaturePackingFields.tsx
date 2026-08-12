"use client";

import { Plus, X } from "lucide-react";
import {
  type FieldArrayWithId,
  type UseFormRegister,
} from "react-hook-form";

type Props = {
  title: string;
  hint: string;
  fields: FieldArrayWithId<any, any, "id">[];
  register: UseFormRegister<any>;
  name: "featureEntries" | "packingEntries";
  onAppend: () => void;
  onRemove: (index: number) => void;
};

/**
 * Optional Features / Packing key-value editors for admin product forms.
 */
export function ProductFeaturePackingFields({
  title,
  hint,
  fields,
  register,
  name,
  onAppend,
  onRemove,
}: Props) {
  return (
    <section className="bg-white p-4 sm:p-5 border border-primary/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-serif text-primary font-bold lowercase">
          {title}
        </h2>
        <p className="text-[10px] uppercase tracking-widest opacity-80">
          {hint}
        </p>
      </div>

      <div className="space-y-6">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="flex flex-col sm:flex-row gap-4 items-start sm:items-center"
          >
            <div className="w-full sm:w-1/3 space-y-2">
              <label className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
                Name
              </label>
              <div className="input-standard">
                <input
                  {...register(`${name}.${index}.key` as const)}
                  placeholder="E.G. FAMILY"
                  className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-stone-800 outline-none transition-all focus:bg-white"
                />
              </div>
            </div>
            <div className="w-full sm:w-2/3 space-y-2">
              <label className="text-[9px] uppercase tracking-[0.12em] font-bold text-stone-500">
                Value
              </label>
              <div className="flex items-center gap-2">
                <div className="input-standard flex-1">
                  <input
                    {...register(`${name}.${index}.value` as const)}
                    placeholder="E.G. SMART"
                    className="w-full bg-secondary/10 px-4 py-3 text-[10px] uppercase tracking-widest text-stone-800 outline-none transition-all focus:bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="p-3 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title={`Remove ${title} row`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        <div className="pt-4 border-t border-primary/10">
          <button
            type="button"
            onClick={onAppend}
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add {title.replace(/s$/i, "") || title}
          </button>
        </div>
      </div>
    </section>
  );
}
