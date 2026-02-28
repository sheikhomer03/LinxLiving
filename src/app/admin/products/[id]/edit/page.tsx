"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Upload,
  ChevronDown,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  price: z.number().min(0, "Price must be positive"),
  stock: z.number().min(0, "Stock must be positive"),
  category: z.string().min(1, "Category is required"),
  status: z.string(),
  specs: z
    .object({
      material: z.string().optional(),
      finish: z.string().optional(),
      size: z.string().optional(),
      slipRating: z.string().optional(),
      variation: z.string().optional(),
      suitability: z.string().optional(),
      rectifiedEdge: z.string().optional(),
      thickness: z.string().optional(),
    })
    .optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const productId = unwrappedParams.id;
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // In a real app, you would fetch data here. Mocking pre-population:
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "KENSINGTON VANITY UNIT",
      description:
        "Hand-crafted from solid alabaster and reclaimed oak, the Kensington Vanity Unit represents the pinnacle of celestial minimalism.",
      price: 1850,
      stock: 12,
      category: "Bathroom",
      status: "Published Archive",
      specs: {
        material: "POLISHED PORCELAIN",
        finish: "HIGH GLOSS",
        size: "600 X 1200 MM",
        slipRating: "R9",
        variation: "V2 - SLIGHT VARIATION",
        suitability: "INTERNAL FLOOR & WALL",
        rectifiedEdge: "YES",
        thickness: "9.5 MM",
      },
    },
  });

  const onSubmit = async (data: ProductFormValues) => {
    setIsSaving(true);
    try {
      // Logic for saving revisions to API
      console.log("Saving revisions:", data);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success("Product revised successfully");
      router.push("/admin/products");
    } catch {
      toast.error("Failed to revise product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    // Logic for deleting asset
    toast.success("Asset purged from registry");
    router.push("/admin/products");
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-700">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/40">
        <Link href="/admin" className="hover:text-[#333] transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-3 h-3" />
        <Link
          href="/admin/products"
          className="hover:text-[#333] transition-colors"
        >
          Products
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-[#333]">Refine Piece</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif tracking-tight text-[#333] font-bold">
            Refine Piece
          </h1>
          <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-40">
            Revision Lifecycle • REF: {productId}
          </p>
        </div>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] font-bold text-red-600/50 hover:text-red-600 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete Product
        </button>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 lg:grid-cols-3 gap-12"
      >
        {/* Left Column: Product Information & Specs */}
        <div className="lg:col-span-2 space-y-12">
          {/* General Information */}
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-10">
            <div className="space-y-1">
              <h2 className="text-xl font-serif text-[#333] font-bold">
                Product Information
              </h2>
              <p className="text-[10px] uppercase tracking-widest opacity-40">
                Refine the core attributes of this masterpiece.
              </p>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Masterpiece Title
                </label>
                <input
                  {...register("name")}
                  type="text"
                  placeholder="Product name"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                />
                {errors.name && (
                  <p className="text-[10px] text-red-500 uppercase tracking-widest">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Visual Narrative
                </label>
                <textarea
                  {...register("description")}
                  placeholder="Product description"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all min-h-[150px] resize-none"
                />
                {errors.description && (
                  <p className="text-[10px] text-red-500 uppercase tracking-widest">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                    Valuation (£)
                  </label>
                  <input
                    {...register("price", { valueAsNumber: true })}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                  />
                  {errors.price && (
                    <p className="text-[10px] text-red-500 uppercase tracking-widest">
                      {errors.price.message}
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                    Registry Stock
                  </label>
                  <input
                    {...register("stock", { valueAsNumber: true })}
                    type="number"
                    placeholder="0"
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-sm font-sans tracking-wide text-[#333] outline-none focus:border-[#333] transition-all"
                  />
                  {errors.stock && (
                    <p className="text-[10px] text-red-500 uppercase tracking-widest">
                      {errors.stock.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Technical Specifications */}
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-10">
            <div className="space-y-1">
              <h2 className="text-xl font-serif text-[#333] font-bold lowercase">
                TECHNICAL <span className="uppercase">SPECIFICATIONS</span>
              </h2>
              <p className="text-[10px] uppercase tracking-widest opacity-40">
                Refine the al technical characteristics.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Material
                </label>
                <input
                  {...register("specs.material")}
                  placeholder="Material specification"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Finish
                </label>
                <input
                  {...register("specs.finish")}
                  placeholder="Finish specification"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Size
                </label>
                <input
                  {...register("specs.size")}
                  placeholder="Dimensional specification"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Slip Rating
                </label>
                <input
                  {...register("specs.slipRating")}
                  placeholder="E.G. R9"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Variation
                </label>
                <input
                  {...register("specs.variation")}
                  placeholder="E.G. V2"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Suitability
                </label>
                <input
                  {...register("specs.suitability")}
                  placeholder="Suitability registry"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Rectified Edge
                </label>
                <input
                  {...register("specs.rectifiedEdge")}
                  placeholder="YES / NO"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Thickness
                </label>
                <input
                  {...register("specs.thickness")}
                  placeholder="E.G. 9.5 MM"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
            </div>
          </section>

          {/* Media Section */}
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8">
            <h2 className="text-[11px] uppercase tracking-[0.5em] font-bold text-[#333] opacity-40 pb-6 border-b border-[#333]/5">
              Visual Archive
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                type="button"
                className="aspect-square bg-secondary/10 border border-dashed border-[#333]/10 flex flex-col items-center justify-center gap-4 hover:bg-secondary/20 transition-all group"
              >
                <Upload className="w-5 h-5 opacity-20 group-hover:opacity-40 transition-opacity" />
                <span className="text-[8px] uppercase tracking-widest font-bold opacity-40">
                  Replace
                </span>
              </button>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8">
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 text-[#333]">
            <h2 className="text-xl font-serif font-bold">Curation</h2>

            <div className="space-y-6">
              <div className="space-y-3 relative group">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-60">
                  Collection
                </label>
                <div className="relative">
                  <select
                    {...register("category")}
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-[12px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Bathroom">Bathroom</option>
                    <option value="Tiles">Tiles</option>
                    <option value="Accessories">Accessories</option>
                    <option value="Lighting">Lighting</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-60">
                  State
                </label>
                <div className="relative group">
                  <select
                    {...register("status")}
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-[12px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Draft">Draft Mode</option>
                    <option value="Published Archive">Published Archive</option>
                    <option value="Archived Legacy">Archived Legacy</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-[#333] text-white py-5 text-[11px] uppercase tracking-[0.4em] font-bold hover:bg-black transition-all shadow-xl disabled:opacity-50"
            >
              {isSaving ? "Synchronizing..." : "Apply Revisions"}
            </button>
            <Link
              href="/admin/products"
              className="block w-full text-center border border-[#333]/10 py-5 text-[11px] uppercase tracking-[0.4em] font-bold hover:bg-secondary/30 transition-all text-[#333]"
            >
              Dismiss Edits
            </Link>
          </div>

          <div className="bg-[#333] p-10 space-y-6 shadow-2xl">
            <div className="space-y-2">
              <h3 className="text-white font-serif text-lg tracking-wide uppercase">
                Revision Log
              </h3>
              <p className="text-[9px] uppercase tracking-[0.3em] text-white/30 font-bold">
                Edits propagate immediately upon synchronization.
              </p>
            </div>
          </div>
        </div>
      </form>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 animate-in fade-in duration-700">
          <div className="bg-white w-full max-w-2xl p-20 shadow-2xl border border-[#333]/5 relative overflow-hidden text-center">
            <div className="relative z-10 flex flex-col items-center space-y-12">
              <div className="w-32 h-px bg-red-600/20" />
              <div className="space-y-6">
                <h2 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
                  Asset Purge
                </h2>
                <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-40 leading-loose max-w-sm mx-auto">
                  Confirming the permanent removal of <br />
                  <span className="text-red-600 font-serif normal-case italic text-2xl tracking-normal">
                    Kensington Vanity Unit
                  </span>
                </p>
              </div>
              <div className="flex flex-col w-full gap-5">
                <button
                  onClick={handleDelete}
                  className="w-full bg-red-600 text-white py-8 text-[11px] uppercase tracking-[0.5em] font-bold hover:bg-black transition-all duration-700 shadow-xl"
                >
                  Confirm Removal
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="w-full text-[#333] py-8 text-[11px] uppercase tracking-[0.5em] font-bold border border-[#333]/5 hover:bg-secondary transition-colors"
                >
                  Retain Masterpiece
                </button>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
              <AlertCircle className="w-64 h-64 text-red-600" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
