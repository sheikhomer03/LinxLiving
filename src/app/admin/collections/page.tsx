"use client";
import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getCollections, deleteCollection } from "@/app/actions/admin";
import {
  Plus,
  Search,
  MoreHorizontal,
  Edit2,
  Trash2,
  Folder,
  Layers,
  AlertCircle,
  LayoutGrid,
  List,
  Filter,
  ArrowUpDown,
  Archive,
  Eye,
  Loader2,
  X,
} from "lucide-react";
import Image from "next/image";
import { Pagination } from "@/components/admin/Pagination";

export default function CollectionsPage() {
  const router = useRouter();
  const [collections, setCollections] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  React.useEffect(() => {
    async function loadCollections() {
      setIsLoading(true);
      try {
        const result = await getCollections(currentPage, itemsPerPage);
        setCollections(result.collections);
        setTotalPages(Math.ceil(result.totalCount / itemsPerPage));
      } catch (error) {
        toast.error("Failed to load collections");
      } finally {
        setIsLoading(false);
      }
    }
    loadCollections();
  }, [currentPage]);

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

  const handleDelete = async () => {
    if (!collectionToDelete) return;
    setIsDeleting(true);
    try {
      const result = await deleteCollection(collectionToDelete.id);
      if (result.success) {
        toast.success("Collection deleted successfully");
        setCollections((prev) =>
          prev.filter((c) => c._id !== collectionToDelete.id),
        );
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete collection");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setCollectionToDelete(null);
    }
  };

  const filteredCollections = collections.filter((c) =>
    (c.name || "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-10 lg:space-y-12 pb-32 animate-in fade-in duration-1000">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
            Collections
          </h1>
        </div>
        <Link
          href="/admin/collections/new"
          className="w-full sm:w-auto bg-[#1a1a1a] hover:bg-black text-primary px-8 lg:px-10 py-3.5 lg:py-4 transition-all shadow-xl flex items-center justify-center gap-4 group overflow-hidden relative border border-primary/20"
        >
          <div className="relative z-10 flex items-center gap-4">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] lg:text-[11px] uppercase tracking-[0.4em] font-black">
              Add Collection
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
            placeholder="Search collections..."
            className="w-full bg-transparent placeholder:text-[#333]/60 text-base lg:text-lg font-serif tracking-wide text-[#333] outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Collections Table */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-[#1a1a1a] text-primary font-black text-[11px] lg:text-[12px] uppercase tracking-[0.2em]">
                <th className="px-6 lg:px-10 py-5">Collection</th>
                <th className="px-6 lg:px-10 py-5 text-center">Created Date</th>
                <th className="px-6 lg:px-10 py-5 text-center">Products</th>
                <th className="px-6 lg:px-10 py-5">Status</th>
                <th className="px-6 lg:px-10 py-5 text-right">Settings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/5">
              {filteredCollections.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-20 lg:py-32 text-center text-[#333]"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-20 h-20 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <Folder className="w-10 h-10 text-primary/60" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-serif font-bold text-primary">
                          No Collections Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-black text-primary/60">
                          {searchTerm
                            ? "Try adjusting your search criteria"
                            : "Your collections list is currently empty"}
                        </p>
                      </div>
                      {!searchTerm && (
                        <Link
                          href="/admin/collections/new"
                          className="mt-4 inline-flex items-center gap-3 px-8 py-4 bg-[#1a1a1a] text-primary text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-black transition-all shadow-lg border border-primary/20"
                        >
                          <Plus className="w-4 h-4" />
                          Create Collection
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCollections.map((collection) => (
                  <tr
                    key={collection._id}
                    className="group hover:bg-secondary/5 transition-all duration-500"
                  >
                    <td className="px-6 lg:px-10 py-6 lg:py-8">
                      <div className="flex items-center gap-4 lg:gap-6">
                        <div className="w-8 h-8 lg:w-12 lg:h-12 bg-[#333]/5 flex items-center justify-center border border-[#333]/10 shrink-0 relative overflow-hidden">
                          {collection.image ? (
                            <Image
                              src={collection.image}
                              alt={collection.name}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <Folder className="w-3.5 h-3.5 lg:w-5 lg:h-5 opacity-80 text-[#333]" />
                          )}
                        </div>
                        <div className="space-y-1 min-w-0">
                          <Link
                            href={`/admin/collections/${collection._id}/edit`}
                            className="text-sm font-serif tracking-wide text-[#333] font-bold hover:underline block truncate"
                          >
                            {collection.name}
                          </Link>
                          <p className="text-[7.5px] lg:text-[8px] uppercase tracking-widest font-bold opacity-90 truncate">
                            Updated{" "}
                            {new Date(
                              collection.updatedAt,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-center text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/40">
                      {new Date(collection.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-center">
                      <span className="text-sm font-serif text-[#333] font-bold">
                        {collection.productCount || 0}
                      </span>
                      <span className="text-[7.5px] lg:text-[8px] uppercase tracking-widest font-bold opacity-90 ml-1.5 lg:ml-2">
                        Items
                      </span>
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8">
                      <div className="flex items-center gap-1.5 lg:gap-2">
                        <div
                          className={`w-1 lg:w-1.5 h-1 lg:h-1.5 rounded-full bg-green-500`}
                        />
                        <span className="text-[8.5px] lg:text-[9px] uppercase tracking-widest font-bold opacity-80">
                          Active
                        </span>
                      </div>
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-right">
                      <button
                        onClick={(e) => toggleMenu(e, collection._id)}
                        className="p-3 bg-primary/5 hover:bg-primary text-primary hover:text-primary-foreground transition-all shadow-sm border border-primary/10 rounded-none"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {openMenuId === collection._id && (
                        <div
                          className="fixed mt-2 w-48 bg-white border border-[#333]/10 shadow-2xl z-100 animate-in fade-in zoom-in duration-300 text-left"
                          style={{ top: menuPos.top, right: menuPos.right }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            href={`/admin/collections/${collection._id}/edit`}
                            className="w-full text-left px-6 py-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-[#333] hover:text-white flex items-center gap-4 transition-colors border-b border-[#333]/5 group/item cursor-pointer"
                          >
                            <Edit2 className="w-4 h-4 opacity-90 group-hover/item:text-white" />
                            Edit Details
                          </Link>
                          <button
                            onClick={() => {
                              setCollectionToDelete({
                                id: collection._id,
                                name: collection.name,
                              });
                              setShowDeleteModal(true);
                              setOpenMenuId(null);
                            }}
                            className="w-full text-left px-6 py-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-red-600 hover:text-white text-red-600 flex items-center gap-4 transition-colors group/item"
                          >
                            <Trash2 className="w-4 h-4 opacity-90 group-hover/item:text-white" />
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

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
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
                  Delete Collection
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Are you sure you want to delete{" "}
                  <span className="font-bold text-[#333]">
                    "{collectionToDelete?.name}"
                  </span>
                  ?
                  <br /> This action cannot be undone.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg disabled:opacity-80 flex items-center justify-center gap-3"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Delete
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
