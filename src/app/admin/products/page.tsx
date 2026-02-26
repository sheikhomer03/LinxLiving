"use client";
import React, { useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Eye,
  MoreHorizontal,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import Image from "next/image";

const DUMMY_PRODUCTS = [
  {
    id: "PROD-001",
    sku: "#87845",
    name: "Kensington Vanity Unit",
    category: "Bathroom",
    price: 997,
    stock: 12,
    sales: 145,
    status: "Active",
    image:
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "PROD-002",
    sku: "#87845",
    name: "Carrara Marble Tile",
    category: "Tiles",
    price: 45,
    stock: 450,
    sales: 1205,
    status: "Active",
    image:
      "https://images.unsplash.com/photo-1590272456521-1799c0011858?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "PROD-003",
    sku: "#87845",
    name: "Stone Basin Minimalist",
    category: "Bathroom",
    price: 597,
    stock: 0,
    sales: 89,
    status: "Out of Stock",
    image:
      "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=400",
  },
  {
    id: "PROD-004",
    sku: "#87845",
    name: "Nero Curved Mirror",
    category: "Accessories",
    price: 245,
    stock: 5,
    sales: 231,
    status: "Draft",
    image:
      "https://images.unsplash.com/photo-1618220179428-22790b461013?auto=format&fit=crop&q=80&w=400",
  },
];

export default function ProductsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDelete, setProductToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const filteredProducts = DUMMY_PRODUCTS.filter((p) => {
    return p.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleDeleteClick = (product: { id: string; name: string }) => {
    setProductToDelete(product);
    setShowDeleteModal(true);
    setOpenMenuId(null);
  };

  const confirmDelete = () => {
    console.log("Deleted:", productToDelete?.id);
    setShowDeleteModal(false);
    setProductToDelete(null);
  };

  return (
    <div className="space-y-24 pb-32 animate-in fade-in duration-1000">
      {/* Header aligned with reference: Product on Left, Add on Right */}
      <header className="flex items-center justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif tracking-tight text-[#333] font-bold">
            Products
          </h1>
          <p className="text-[10px] uppercase tracking-[0.5em] font-black opacity-40">
            Catalog Archive v2.1
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="bg-[#333] hover:bg-black text-white px-10 py-4 transition-all shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] flex items-center gap-4 group overflow-hidden relative"
        >
          <div className="relative z-10 flex items-center gap-4">
            <Plus className="w-5 h-5 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[11px] uppercase tracking-[0.4em] font-black">
              Add Product
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20" />
        </Link>
      </header>

      {/* Refined Minimalist Search Bar (Matching Reference) */}
      <div className="bg-white border border-[#333]/80 px-8 py-5 flex items-center gap-6 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.1)] group transition-all duration-700 hover:shadow-[0_15px_40px_-15px_rgba(0,0,0,0.15)] mb-12">
        <div className="shrink-0">
          <Search className="w-5 h-5 text-[#333] group-focus-within:opacity-100 transition-opacity" />
        </div>

        <div className="grow">
          <input
            type="search"
            placeholder="Search products..."
            className="w-full bg-transparent placeholder:text-gray-400 text-lg font-serif tracking-wide text-[#333] outline-none transition-all uppercase"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* <button className="flex items-center gap-3 px-6 py-2 border-l border-[#333]/80 text-[10px] uppercase tracking-[0.4em] font-black text-[#333] hover:text-[#333] transition-all group/btn">
          <span>Filters</span>
          <ChevronDown className="w-4 h-4 opacity-80 group-hover/btn:opacity-100 transition-all group-hover/btn:translate-y-0.5" />
        </button> */}
      </div>

      {/* Table Remodel with #333 Header Background */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#333] text-white font-black text-[12px] uppercase tracking-[0.2em]">
              <th className="px-10 py-5">Name</th>
              <th className="px-10 py-5">No</th>
              <th className="px-10 py-5">Category</th>
              <th className="px-10 py-5">Price</th>
              <th className="px-10 py-5">Stock</th>
              <th className="px-10 py-5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#333]/10">
            {filteredProducts.map((product) => (
              <tr
                key={product.id}
                className="group hover:bg-secondary/5 transition-all duration-500"
              >
                <td className="px-10 py-5">
                  <div className="flex items-center gap-8">
                    <div className="relative w-16 h-16 bg-secondary/20 overflow-hidden shadow-sm border border-[#333]/5 group-hover:shadow-md transition-shadow">
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                      />
                    </div>
                    <div>
                      <Link
                        href={`/admin/products/${product.id}/edit`}
                        className="text-base tracking-wide text-[#333] hover:underline transition-all"
                      >
                        {product.name}
                      </Link>
                    </div>
                  </div>
                </td>
                <td className="px-10 py-5 text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/40">
                  {product.sku}
                </td>
                <td className="px-10 py-5 text-[11px] uppercase tracking-[0.3em] font-black text-[#333]/60">
                  {product.category}
                </td>
                <td className="px-10 py-5 text-xl font-serif text-[#333]">
                  £
                  {product.price.toLocaleString("en-GB", {
                    minimumFractionDigits: 2,
                  })}
                </td>
                <td className="px-10 py-5 text-sm font-black text-[#333]/60 uppercase tracking-widest">
                  {product.stock}
                </td>
                <td className="px-10 py-5 relative text-right">
                  <button
                    onClick={() =>
                      setOpenMenuId(
                        openMenuId === product.id ? null : product.id,
                      )
                    }
                    className="p-3 bg-secondary/10 hover:bg-[#333] hover:text-white transition-all opacity-40 group-hover:opacity-100 shadow-sm"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>

                  {/* Action Dropdown aligned with reference */}
                  {openMenuId === product.id && (
                    <div className="absolute right-10 mt-3 w-40 bg-white border border-[#333]/10 shadow-2xl z-50 animate-in fade-in zoom-in duration-300 text-left">
                      <Link
                        href={`/admin/products/${product.id}/edit`}
                        className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/20 flex items-center gap-4 transition-colors border-b border-[#333]/5"
                      >
                        <Edit2 className="w-5 h-5 opacity-70" />
                        Edit
                      </Link>
                      <button
                        onClick={() => handleDeleteClick(product)}
                        className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold hover:bg-red-50 text-red-600 flex items-center gap-4 transition-colors"
                      >
                        <Trash2 className="w-5 h-5 opacity-70" />
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-xl px-4 animate-in fade-in duration-700">
          <div className="bg-white w-full max-w-2xl p-20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-[#333]/5 relative overflow-hidden group">
            <div className="relative z-10 flex flex-col items-center text-center space-y-12">
              <div className="w-32 h-px bg-red-600/20" />
              <div className="space-y-6">
                <h2 className="text-4xl font-serif uppercase tracking-[0.2em] text-[#333]">
                  Catalog Removal
                </h2>
                <p className="text-[11px] uppercase tracking-[0.4em] font-black opacity-40 leading-loose max-w-sm mx-auto">
                  Confirming the permanent removal of <br />
                  <span className="text-red-600 font-serif normal-case italic text-2xl tracking-normal">
                    {productToDelete?.name}
                  </span>
                </p>
              </div>
              <div className="flex flex-col w-full gap-5 pt-8">
                <button
                  onClick={confirmDelete}
                  className="w-full bg-red-600 text-white py-8 text-[11px] uppercase tracking-[0.5em] font-bold hover:bg-black transition-all duration-700 shadow-2xl"
                >
                  Finalize Deletion
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="w-full text-[#333] py-8 text-[11px] uppercase tracking-[0.5em] font-bold border border-[#333]/10 hover:bg-secondary transition-all"
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
