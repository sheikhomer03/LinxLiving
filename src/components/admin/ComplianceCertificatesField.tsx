"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

export function ComplianceCertificatesField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const certs = Array.isArray(value) ? value : [];

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "linx-living/certificates");
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
      onChange([...certs, json.url]);
      toast.success("Certificate uploaded");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 md:col-span-2">
      <label className="text-[9px] uppercase tracking-widest font-bold text-stone-500">
        Compliance certificates
      </label>
      {certs.length === 0 ? (
        <p className="text-xs text-stone-400">No certificates uploaded.</p>
      ) : (
        <ul className="space-y-2">
          {certs.map((url) => (
            <li
              key={url}
              className="flex items-center gap-2 text-xs border border-stone-200 px-3 py-2 bg-white"
            >
              <FileText className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-primary underline flex-1"
              >
                {url.split("/").pop()}
              </a>
              <button
                type="button"
                onClick={() => onChange(certs.filter((u) => u !== url))}
                className="p-1 text-red-500 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="inline-flex items-center gap-2 text-[9px] uppercase tracking-widest font-bold border border-primary/30 px-3 py-2 text-primary cursor-pointer hover:bg-primary/5">
        {uploading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Plus className="w-3.5 h-3.5" />
        )}
        Upload PDF / image
        <input
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
