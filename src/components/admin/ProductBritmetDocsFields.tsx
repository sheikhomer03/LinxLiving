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

async function uploadFile(file: File, folder: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
  return String(json.url);
}

function NamedFileRow({
  prefix,
  control,
  register,
  setValue,
  folder,
  onRemove,
}: {
  prefix: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  folder: string;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const url = useWatch({ control, name: `${prefix}.url` }) || "";

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-end rounded-md border border-stone-100 bg-white p-3">
      <div className="flex-1 space-y-1">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          Name
        </label>
        <input
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
          placeholder="e.g. Brochure (PDF)"
          {...register(`${prefix}.name`)}
        />
      </div>
      <div className="flex items-center gap-2">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-primary underline inline-flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5" />
            View
          </a>
        ) : null}
        <label className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-bold text-stone-600 cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "…" : "Upload"}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.zip,application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setUploading(true);
              try {
                const uploaded = await uploadFile(file, folder);
                setValue(`${prefix}.url`, uploaded, { shouldDirty: true });
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
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <input type="hidden" {...register(`${prefix}.url`)} />
    </div>
  );
}

function NamedFileList({
  name,
  title,
  hint,
  control,
  register,
  setValue,
  folder,
}: {
  name: "brochures" | "installerGuides";
  title: string;
  hint: string;
} & Props & { folder: string }) {
  const { fields, append, remove } = useFieldArray({ control, name });

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
          <p className="mt-1 text-xs text-stone-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() => append({ name: "", url: "" })}
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-stone-500">None added yet.</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <NamedFileRow
              key={field.id}
              prefix={`${name}.${index}`}
              control={control}
              register={register}
              setValue={setValue}
              folder={folder}
              onRemove={() => remove(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Optional Britmet-style documentation tabs for admin product form. */
export function ProductBritmetDocsFields({
  control,
  register,
  setValue,
}: Props) {
  const range = useFieldArray({ control, name: "productRange" });
  const cases = useFieldArray({ control, name: "caseStudies" });
  const drawings = useFieldArray({ control, name: "drawingEntries" });
  const genImage =
    useWatch({ control, name: "generalSpecification.image" }) || "";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-[11px] uppercase tracking-[0.18em] font-bold text-primary opacity-80">
          Product documentation tabs
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          Optional Britmet-style tabs shown with Product Description and
          Technical Specifications on the product page.
        </p>
      </div>

      <NamedFileList
        name="brochures"
        title="Brochure"
        hint="Name + PDF/file for each brochure or datasheet."
        control={control}
        register={register}
        setValue={setValue}
        folder="ecommerce-pro/products/brochures"
      />

      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Product Range
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              Name, image, and optional custom table (headings + row values).
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              range.append({
                name: "",
                image: "",
                tableHeadings: [],
                tableRows: [],
              })
            }
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary"
          >
            <Plus className="w-3.5 h-3.5" />
            Add item
          </button>
        </div>
        {range.fields.map((field, index) => (
          <RangeRow
            key={field.id}
            index={index}
            control={control}
            register={register}
            setValue={setValue}
            onRemove={() => range.remove(index)}
          />
        ))}
      </div>

      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Case Studies
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              Cover image, name, and PDF/file.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              cases.append({ name: "", coverImage: "", file: "" })
            }
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
        {cases.fields.map((field, index) => (
          <CaseRow
            key={field.id}
            index={index}
            register={register}
            setValue={setValue}
            onRemove={() => cases.remove(index)}
          />
        ))}
      </div>

      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
        <h3 className="text-sm font-semibold text-stone-900">
          General Specification
        </h3>
        <p className="text-xs text-stone-500">Text content with optional image.</p>
        <textarea
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm min-h-[120px]"
          placeholder="Handling and storage, installation notes…"
          {...register("generalSpecification.content")}
        />
        <div className="flex items-center gap-3">
          {genImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={genImage}
              alt=""
              className="w-20 h-20 object-contain border border-stone-100"
            />
          ) : null}
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-600 cursor-pointer inline-flex items-center gap-1">
            <Upload className="w-3.5 h-3.5" />
            Image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const url = await uploadFile(
                    file,
                    "ecommerce-pro/products/general-spec",
                  );
                  setValue("generalSpecification.image", url, {
                    shouldDirty: true,
                  });
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Upload failed");
                }
              }}
            />
          </label>
          <input type="hidden" {...register("generalSpecification.image")} />
        </div>
      </div>

      <NamedFileList
        name="installerGuides"
        title="Installer Guide"
        hint="Name + PDF/file for installer / care guides."
        control={control}
        register={register}
        setValue={setValue}
        folder="ecommerce-pro/products/installer-guides"
      />

      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Technical Drawings
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              Ref, Description, and file(s).
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              drawings.append({
                ref: "",
                description: "",
                files: [{ name: "PDF", url: "" }],
              })
            }
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-primary"
          >
            <Plus className="w-3.5 h-3.5" />
            Add row
          </button>
        </div>
        {drawings.fields.map((field, index) => (
          <div
            key={field.id}
            className="rounded-md border border-stone-100 bg-white p-3 space-y-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="rounded-md border border-stone-200 px-3 py-2 text-sm"
                placeholder="Ref"
                {...register(`drawingEntries.${index}.ref`)}
              />
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  placeholder="Description"
                  {...register(`drawingEntries.${index}.description`)}
                />
                <button
                  type="button"
                  onClick={() => drawings.remove(index)}
                  className="p-2 text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <label className="text-[10px] uppercase tracking-wide font-bold text-stone-600 cursor-pointer inline-flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" />
              Upload drawing file
              <input
                type="file"
                accept=".pdf,.dwg,.dxf,application/pdf"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const url = await uploadFile(
                      file,
                      "ecommerce-pro/products/drawings",
                    );
                    const ext =
                      file.name.split(".").pop()?.toUpperCase() || "PDF";
                    setValue(
                      `drawingEntries.${index}.files`,
                      [{ name: ext, url }],
                      { shouldDirty: true },
                    );
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Upload failed");
                  }
                }}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function RangeRow({
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
  const image =
    useWatch({ control, name: `productRange.${index}.image` }) || "";
  const headings =
    useWatch({ control, name: `productRange.${index}.tableHeadings` }) || [];
  const rows =
    useWatch({ control, name: `productRange.${index}.tableRows` }) || [];

  return (
    <div className="rounded-md border border-stone-100 bg-white p-3 space-y-3">
      <div className="flex gap-2 items-start">
        <div className="flex-1 space-y-1">
          <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
            Name
          </label>
          <input
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
            {...register(`productRange.${index}.name`)}
          />
        </div>
        <button type="button" onClick={onRemove} className="p-2 text-red-500">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="w-14 h-14 object-contain border border-stone-100"
          />
        ) : null}
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-600 cursor-pointer inline-flex items-center gap-1">
          <Upload className="w-3.5 h-3.5" />
          Image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const url = await uploadFile(
                  file,
                  "ecommerce-pro/products/product-range",
                );
                setValue(`productRange.${index}.image`, url, {
                  shouldDirty: true,
                });
              } catch (err) {
                alert(err instanceof Error ? err.message : "Upload failed");
              }
            }}
          />
        </label>
        <input type="hidden" {...register(`productRange.${index}.image`)} />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          Table headings (comma-separated)
        </label>
        <input
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
          placeholder="Ref, Description, Size"
          defaultValue={Array.isArray(headings) ? headings.join(", ") : ""}
          onBlur={(e) => {
            setValue(
              `productRange.${index}.tableHeadings`,
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              { shouldDirty: true },
            );
          }}
        />
        <label className="text-[10px] uppercase tracking-wide font-bold text-stone-500">
          Table rows (one row per line, cells with |)
        </label>
        <textarea
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm min-h-[72px]"
          placeholder="A1 | Widget | 100mm"
          defaultValue={
            Array.isArray(rows)
              ? rows.map((r: string[]) => (r || []).join(" | ")).join("\n")
              : ""
          }
          onBlur={(e) => {
            const next = e.target.value
              .split("\n")
              .map((line) => line.split("|").map((c) => c.trim()))
              .filter((r) => r.some(Boolean));
            setValue(`productRange.${index}.tableRows`, next, {
              shouldDirty: true,
            });
          }}
        />
      </div>
    </div>
  );
}

function CaseRow({
  index,
  register,
  setValue,
  onRemove,
}: {
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-stone-100 bg-white p-3 space-y-2">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-stone-200 px-3 py-2 text-sm"
          placeholder="Case study name"
          {...register(`caseStudies.${index}.name`)}
        />
        <button type="button" onClick={onRemove} className="p-2 text-red-500">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-wide font-bold text-stone-600">
        <label className="cursor-pointer inline-flex items-center gap-1">
          <Upload className="w-3.5 h-3.5" />
          Cover image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const url = await uploadFile(
                  file,
                  "ecommerce-pro/products/case-studies",
                );
                setValue(`caseStudies.${index}.coverImage`, url, {
                  shouldDirty: true,
                });
              } catch (err) {
                alert(err instanceof Error ? err.message : "Upload failed");
              }
            }}
          />
        </label>
        <label className="cursor-pointer inline-flex items-center gap-1">
          <Upload className="w-3.5 h-3.5" />
          File
          <input
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const url = await uploadFile(
                  file,
                  "ecommerce-pro/products/case-studies",
                );
                setValue(`caseStudies.${index}.file`, url, {
                  shouldDirty: true,
                });
              } catch (err) {
                alert(err instanceof Error ? err.message : "Upload failed");
              }
            }}
          />
        </label>
      </div>
      <input type="hidden" {...register(`caseStudies.${index}.coverImage`)} />
      <input type="hidden" {...register(`caseStudies.${index}.file`)} />
    </div>
  );
}
