"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronRight, Upload, ChevronDown } from "lucide-react";
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

export default function AddProductPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      status: "Draft",
      name: "",
      description: "",
      price: 0,
      stock: 0,
      category: "",
      specs: {
        material: "",
        finish: "",
        size: "",
        slipRating: "",
        variation: "",
        suitability: "",
        rectifiedEdge: "",
        thickness: "",
      },
    },
  });

  const onSubmit = async (data: ProductFormValues) => {
    setIsSaving(true);
    try {
      // Logic for saving to API would go here
      console.log("Saving product:", data);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success("Product created successfully");
      router.push("/admin/products");
    } catch {
      toast.error("Failed to create product");
    } finally {
      setIsSaving(false);
    }
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
        <span className="text-[#333]">New Product</span>
      </nav>

      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-5xl font-serif tracking-tight text-[#333] font-bold">
          New Product
        </h1>
        <p className="text-[11px] uppercase tracking-[0.4em] font-bold opacity-40">
          Add a new product to the catalog.
        </p>
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
                Enter the basic details for the new product.
              </p>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Name
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
                  Description
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
                    Price (£)
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
                    Stock
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
                Define the al characteristics of this piece.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Material
                </label>
                <input
                  {...register("specs.material")}
                  placeholder="E.G. POLISHED PORCELAIN"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Finish
                </label>
                <input
                  {...register("specs.finish")}
                  placeholder="E.G. HIGH GLOSS"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Size
                </label>
                <input
                  {...register("specs.size")}
                  placeholder="E.G. 600 X 1200 MM"
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
                  placeholder="E.G. V2 - SLIGHT VARIATION"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Suitability
                </label>
                <input
                  {...register("specs.suitability")}
                  placeholder="E.G. INTERNAL FLOOR & WALL"
                  className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-3 text-[11px] uppercase tracking-widest text-[#333] outline-none focus:border-[#333] transition-all"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-[0.3em] font-bold text-[#333]/60">
                  Rectified Edge
                </label>
                <input
                  {...register("specs.rectifiedEdge")}
                  placeholder="E.G. YES"
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
              Product Images
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                type="button"
                className="aspect-square bg-secondary/10 border border-dashed border-[#333]/10 flex flex-col items-center justify-center gap-4 hover:bg-secondary/20 transition-all group"
              >
                <Upload className="w-5 h-5 opacity-20 group-hover:opacity-40 transition-opacity" />
                <span className="text-[8px] uppercase tracking-widest font-bold opacity-40">
                  Upload
                </span>
              </button>
            </div>
          </section>
        </div>

        {/* Right Column: Organization & Actions */}
        <div className="space-y-8">
          <section className="bg-white p-10 border border-[#333]/5 shadow-[0_20px_50px_rgba(0,0,0,0.02)] space-y-8 text-[#333]">
            <h2 className="text-xl font-serif font-bold">Organization</h2>

            <div className="space-y-6">
              <div className="space-y-3 relative group">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-60">
                  Category
                </label>
                <div className="relative">
                  <select
                    {...register("category")}
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-[12px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="">Select category</option>
                    <option value="Bathroom">Bathroom</option>
                    <option value="Tiles">Tiles</option>
                    <option value="Accessories">Accessories</option>
                    <option value="Lighting">Lighting</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity" />
                </div>
                {errors.category && (
                  <p className="text-[10px] text-red-500 uppercase tracking-widest">
                    {errors.category.message}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-60">
                  Status
                </label>
                <div className="relative group">
                  <select
                    {...register("status")}
                    className="w-full bg-secondary/20 border-b border-[#333]/10 px-4 py-4 text-[12px] uppercase tracking-[0.2em] font-bold outline-none focus:border-[#333] transition-all cursor-pointer appearance-none"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Active">Active</option>
                    <option value="Archived">Archived</option>
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
              {isSaving ? "Creating..." : "Create Product"}
            </button>
            <Link
              href="/admin/products"
              className="block w-full text-center border border-[#333]/10 py-5 text-[11px] uppercase tracking-[0.4em] font-bold hover:bg-secondary/30 transition-all text-[#333]"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
