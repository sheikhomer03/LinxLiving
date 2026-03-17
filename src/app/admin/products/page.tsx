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
  Loader2,
  X,
  Package,
} from "lucide-react";
import Image from "next/image";

import { useRealtimeProducts } from "@/hooks/useRealtimeProducts";
import { deleteProduct } from "@/app/actions/admin";
import { toast } from "sonner";
import { Pagination } from "@/components/admin/Pagination";

export default function ProductsPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { products, totalPages, loading, refresh } = useRealtimeProducts(
    currentPage,
    itemsPerPage,
    10000,
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [productToDelete, setProductToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const filteredProducts = products.filter((p) => {
    return p.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleDeleteClick = (product: { id: string; name: string }) => {
    setProductToDelete(product);
    setShowDeleteModal(true);
    setOpenMenuId(null);
  };

  const toggleMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (openMenuId === id) {
      setOpenMenuId(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom,
        right: window.innerWidth - rect.right,
      });
      setOpenMenuId(id);
    }
  };

  React.useEffect(() => {
    const handleClick = () => setOpenMenuId(null);
    const handleScroll = () => setOpenMenuId(null);
    if (openMenuId) {
      window.addEventListener("click", handleClick);
      window.addEventListener("scroll", handleScroll, true);
    }
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [openMenuId]);

  const confirmDelete = async () => {
    if (!productToDelete) return;
    setIsDeleting(true);
    try {
      const result = await deleteProduct(productToDelete.id);
      if (result.success) {
        toast.success("Product deleted successfully");
        refresh();
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete product");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setProductToDelete(null);
    }
  };

  if (loading && products.length === 0) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10 lg:space-y-12 pb-32 animate-in fade-in duration-1000">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
            Products
          </h1>
        </div>
        <Link
          href="/admin/products/new"
          className="w-full sm:w-auto bg-[#1a1a1a] hover:bg-black text-primary px-8 lg:px-10 py-3.5 lg:py-4 transition-all shadow-xl flex items-center justify-center gap-4 group overflow-hidden relative border border-primary/20"
        >
          <div className="relative z-10 flex items-center gap-4">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] lg:text-[11px] uppercase tracking-[0.4em] font-black">
              Add Product
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/20" />
        </Link>
      </header>

      {/* Search Bar */}
      <div className="bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-[#333]/5 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12">
        <div className="shrink-0">
          <Search className="w-5 h-5 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search products..."
            className="w-full bg-transparent placeholder:text-[#333]/60 text-base lg:text-lg font-serif tracking-wide text-[#333] outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-[#1a1a1a] text-primary font-black text-[11px] lg:text-[12px] uppercase tracking-[0.2em]">
                <th className="px-6 lg:px-10 py-5">Name</th>
                <th className="px-6 lg:px-10 py-5">Category</th>
                <th className="px-6 lg:px-10 py-5">Price</th>
                <th className="px-6 lg:px-10 py-5">Stock</th>
                <th className="px-6 lg:px-10 py-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/10">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-20 lg:py-32 text-center text-[#333]"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-20 h-20 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <Package className="w-10 h-10 text-primary/60" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-serif font-bold text-primary">
                          No Products Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-black text-primary/60">
                          {searchTerm
                            ? "Try adjusting your search criteria"
                            : "Your catalog is currently empty"}
                        </p>
                      </div>
                      {!searchTerm && (
                        <Link
                          href="/admin/products/new"
                          className="mt-4 inline-flex items-center gap-3 px-8 py-4 bg-[#1a1a1a] text-primary text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-black transition-all shadow-lg border border-primary/20"
                        >
                          <Plus className="w-4 h-4" />
                          Add First Product
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr
                    key={product._id}
                    className="group hover:bg-secondary/5 transition-all duration-500"
                  >
                    <td className="px-6 lg:px-10 py-5 lg:py-6">
                      <div className="flex items-center gap-4 lg:gap-8">
                        <div className="relative w-16 h-16 bg-secondary/20 overflow-hidden shadow-sm border border-[#333]/5 group-hover:shadow-md transition-shadow shrink-0">
                          {product.images && product.images[0] ? (
                            <Image
                              src={product.images[0]}
                              alt={product.name}
                              fill
                              className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center opacity-90">
                              <Plus className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 max-w-sm lg:max-w-sm">
                          <Link
                            href={`/admin/products/${product._id}/edit`}
                            className="text-sm lg:text-base tracking-wide text-[#333] hover:underline transition-all block truncate"
                            title={product.name}
                          >
                            {product.name}
                          </Link>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 lg:px-10 py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-black text-[#333]/60">
                      <div className="flex flex-col">
                        <span>{product.category}</span>
                        {product.subCategory && (
                          <span className="text-[8px] opacity-60">
                            {product.subCategory}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 lg:px-10 py-5 text-lg lg:text-xl font-serif text-[#333]">
                      £
                      {product.price.toLocaleString("en-GB", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-6 lg:px-10 py-5 text-[12px] lg:sm font-black text-[#333]/60 uppercase tracking-widest">
                      {product.stock}
                    </td>
                    <td className="px-10 py-5 text-right">
                      <button
                        onClick={(e) => toggleMenu(e, product._id)}
                        className="p-3 bg-primary/5 hover:bg-primary text-primary hover:text-primary-foreground transition-all shadow-sm border border-primary/10"
                      >
                        <MoreHorizontal className="w-5 h-5" />
                      </button>

                      {/* Action Dropdown aligned with reference */}
                      {openMenuId === product._id && (
                        <div
                          className="fixed mt-2 w-40 bg-white border border-[#333]/10 shadow-2xl z-100 animate-in fade-in zoom-in duration-300 text-left"
                          style={{ top: menuPos.top, right: menuPos.right }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            href={`/admin/products/${product._id}/edit`}
                            className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/20 flex items-center gap-4 transition-colors border-b border-[#333]/5"
                          >
                            <Edit2 className="w-5 h-5 opacity-90" />
                            Edit
                          </Link>
                          <button
                            onClick={() =>
                              handleDeleteClick({
                                id: product._id,
                                name: product.name,
                              })
                            }
                            className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold hover:bg-red-50 text-red-600 flex items-center gap-4 transition-colors"
                          >
                            <Trash2 className="w-5 h-5 opacity-90" />
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          className="border-t border-[#333]/5 px-6 lg:px-10"
        />
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />

          {/* Modal Content */}
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => !isDeleting && setShowDeleteModal(false)}
              disabled={isDeleting}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10 disabled:opacity-80"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 opacity-90" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-[#333]">
                  Catalog Removal
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Confirming removal of{" "}
                  <span className="font-bold text-[#333]">
                    "{productToDelete?.name}"
                  </span>
                  .<br /> This action cannot be undone.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg disabled:opacity-80 flex items-center justify-center gap-3"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="h-1.5 w-full bg-linear-to-r from-red-600/20 via-red-600/10 to-transparent" />
          </div>
        </div>
      )}
    </div>
  );
}
