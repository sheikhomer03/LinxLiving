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
  fd.append("folder", "ecommerce-pro/products/files-documentation");
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) {
    throw new Error(json.error || "File upload failed");
  }
  return String(json.url);
}

function FileRow({
  sectionIndex,
  fileIndex,
  control,
  register,
  setValue,
  onRemove,
}: {
  sectionIndex: number;
  fileIndex: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const prefix =
    `filesDocumentation.${sectionIndex}.files.${fileIndex}` as const;
  const url = useWatch({ control, name: `${prefix}.url` }) || "";

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-end rounded-md border border-stone-100 bg-white p-3">
      <div className="flex-1 space-y-1">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          File name
        </label>
        <input
          type="text"
          placeholder="e.g. Catalogue (PDF)"
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
          {...register(`${prefix}.title`)}
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
        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-stone-200 text-xs font-semibold cursor-pointer hover:bg-stone-50">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "…" : "PDF"}
          <input
            type="file"
            accept="application/pdf,.pdf,.zip,application/zip"
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
                setValue(
                  `${prefix}.type`,
                  file.name.toLowerCase().endsWith(".zip") ? "zip" : "pdf",
                  { shouldDirty: true },
                );
              } catch (err) {
                alert(err instanceof Error ? err.message : "Upload failed");
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
          aria-label="Remove file"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <input type="hidden" {...register(`${prefix}.url`)} />
      <input type="hidden" {...register(`${prefix}.type`)} />
    </div>
  );
}

function SectionBlock({
  sectionIndex,
  control,
  register,
  setValue,
  onRemoveSection,
}: {
  sectionIndex: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  onRemoveSection: () => void;
}) {
  const files = useFieldArray({
    control,
    name: `filesDocumentation.${sectionIndex}.files`,
  });

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Section heading
          </label>
          <input
            type="text"
            placeholder="e.g. CATALOGUES"
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold uppercase outline-none focus:border-stone-400"
            {...register(`filesDocumentation.${sectionIndex}.heading`)}
          />
        </div>
        <button
          type="button"
          onClick={onRemoveSection}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
          aria-label="Remove section"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {files.fields.map((field, fileIndex) => (
          <FileRow
            key={field.id}
            sectionIndex={sectionIndex}
            fileIndex={fileIndex}
            control={control}
            register={register}
            setValue={setValue}
            onRemove={() => files.remove(fileIndex)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => files.append({ title: "", url: "", type: "pdf" })}
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black"
      >
        <Plus className="w-3.5 h-3.5" />
        Add file
      </button>
    </div>
  );
}

/**
 * Optional Porcelanosa-style Files and Documentation:
 * main headings (CATALOGUES, TECHNICAL DOCUMENTATION, …) + PDF/ZIP files.
 */
export function ProductFilesDocumentationFields({
  control,
  register,
  setValue,
}: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "filesDocumentation",
  });

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">
            Files and Documentation
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            Optional — headed sections (e.g. Catalogues, Technical
            documentation) with PDF/ZIP files. Separate from Downloads.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            append({
              heading: "",
              files: [{ title: "", url: "", type: "pdf" }],
            })
          }
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary hover:text-black transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add heading
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-stone-500">
          No sections yet. Click Add heading to create a group.
        </p>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <SectionBlock
              key={field.id}
              sectionIndex={index}
              control={control}
              register={register}
              setValue={setValue}
              onRemoveSection={() => remove(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
