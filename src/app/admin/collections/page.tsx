"use client";

import React, { useState } from "react";
import Link from "next/link";
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
} from "lucide-react";

const DUMMY_COLLECTIONS = [
  {
    id: "COLL-001",
    name: "Luxury Tiles",
    slug: "tiles",
    productCount: 124,
    status: "Active",
    lastUpdated: "2 hours ago",
    description: "Hand-picked Italian marble and ceramic surfaces.",
    visibility: "Public",
  },
  {
    id: "COLL-002",
    name: "Stone Baths",
    slug: "baths",
    productCount: 18,
    status: "Active",
    lastUpdated: "5 hours ago",
    description: "Solid stone basins and freestanding luxury baths.",
    visibility: "Public",
  },
  {
    id: "COLL-003",
    name: "Vanity Units",
    slug: "vanity-units",
    productCount: 32,
    status: "Active",
    lastUpdated: "Yesterday",
    description: "Artisanal woodwork paired with stone tops.",
    visibility: "Public",
  },
  {
    id: "COLL-004",
    name: "Accessories",
    slug: "accessories",
    productCount: 85,
    status: "Draft",
    lastUpdated: "3 days ago",
    description: "Finishing touches for refined living spaces.",
    visibility: "Private",
  },
];

export default function CollectionsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("table");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const filteredCollections = DUMMY_COLLECTIONS.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="space-y-16 pb-32 animate-in fade-in duration-1000">
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-serif tracking-tight text-[#333] font-bold">
              Collections
            </h1>
            <span className="px-3 py-1 bg-secondary text-[9px] font-bold uppercase tracking-widest text-[#333]/50 border border-[#333]/5">
              Store Organizer
            </span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-40">
            Create and manage your product categories
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/admin/collections/new"
            className="bg-[#333] hover:bg-black text-white px-8 py-4 transition-all shadow-xl flex items-center gap-4 group overflow-hidden relative"
          >
            <div className="relative z-10 flex items-center gap-4">
              <Plus className="w-5 h-5 transition-transform duration-500 group-hover:rotate-180" />
              <span className="text-[10px] uppercase tracking-[0.4em] font-bold">
                Add Collection
              </span>
            </div>
          </Link>
        </div>
      </header>

      {/* Refined Minimalist Search Bar (Matching Products Page) */}
      <div className="bg-white border border-[#333]/80 px-8 py-5 flex items-center gap-6 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.1)] group transition-all duration-700 hover:shadow-[0_15px_40px_-15px_rgba(0,0,0,0.15)]">
        <div className="shrink-0">
          <Search className="w-5 h-5 text-[#333] group-focus-within:opacity-100 transition-opacity" />
        </div>

        <div className="grow">
          <input
            type="search"
            placeholder="Search collections..."
            className="w-full bg-transparent placeholder:text-gray-400 text-lg font-serif tracking-wide text-[#333] outline-none transition-all uppercase"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex flex-col xl:flex-row gap-6 items-center justify-end">
        {/* Filters & View Toggles */}
        <div className="flex items-center gap-4 w-full xl:w-auto overflow-x-auto pb-2 xl:pb-0">
          <button className="flex items-center gap-3 px-6 py-4 bg-white border border-[#333]/10 text-[10px] uppercase tracking-[0.4em] font-bold text-[#333] hover:bg-secondary transition-all whitespace-nowrap">
            <Filter className="w-4 h-4" />
            <span>Filters</span>
            <span className="w-5 h-5 bg-[#333] text-white rounded-full flex items-center justify-center text-[8px] ml-2">
              2
            </span>
          </button>

          <div className="h-10 w-px bg-[#333]/10 hidden lg:block" />

          <div className="flex bg-secondary/30 p-1 border border-[#333]/5">
            <button
              onClick={() => setViewMode("table")}
              className={`p-3 transition-all ${viewMode === "table" ? "bg-white text-[#333] shadow-sm" : "text-[#333]/40 hover:text-[#333]"}`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-3 transition-all ${viewMode === "grid" ? "bg-white text-[#333] shadow-sm" : "text-[#333]/40 hover:text-[#333]"}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Catalog Display */}
      {viewMode === "table" ? (
        <div className="bg-white shadow-[0_30px_60px_-15px_rgba(0,0,0,0.05)] border border-[#333]/5 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-secondary/50 text-[#333] font-bold text-[9px] uppercase tracking-[0.4em] border-b border-[#333]/5">
                <th className="px-10 py-6">Collection</th>
                <th className="px-10 py-6 text-center">URL Link</th>
                <th className="px-10 py-6 text-center">Products</th>
                <th className="px-10 py-6">Status</th>
                <th className="px-10 py-6">Visibility</th>
                <th className="px-10 py-6 text-right">Settings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/5">
              {filteredCollections.map((collection) => (
                <tr
                  key={collection.id}
                  className="group hover:bg-secondary/10 transition-all duration-500"
                >
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-6">
                      <div className="w-10 h-10 bg-[#333]/5 flex items-center justify-center border border-[#333]/10">
                        <Folder className="w-4 h-4 opacity-40 text-[#333]" />
                      </div>
                      <div className="space-y-1">
                        <Link
                          href={`/admin/collections/${collection.id}/edit`}
                          className="text-sm font-serif tracking-wide text-[#333] font-bold hover:underline"
                        >
                          {collection.name}
                        </Link>
                        <p className="text-[8px] uppercase tracking-widest font-bold opacity-30">
                          Updated {collection.lastUpdated}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-8 text-center text-[10px] uppercase tracking-[0.3em] font-bold text-[#333]/40">
                    /{collection.slug}
                  </td>
                  <td className="px-10 py-8 text-center">
                    <span className="text-sm font-serif text-[#333] font-bold">
                      {collection.productCount}
                    </span>
                    <span className="text-[8px] uppercase tracking-widest font-bold opacity-30 ml-2">
                      Items
                    </span>
                  </td>
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          collection.status === "Active"
                            ? "bg-green-500"
                            : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        }`}
                      />
                      <span className="text-[9px] uppercase tracking-widest font-bold opacity-50">
                        {collection.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-3">
                      <Eye className="w-3 h-3 opacity-30" />
                      <span className="text-[9px] uppercase tracking-widest font-bold opacity-50">
                        {collection.visibility}
                      </span>
                    </div>
                  </td>
                  <td className="px-10 py-8 relative text-right">
                    <button
                      onClick={() =>
                        setOpenMenuId(
                          openMenuId === collection.id ? null : collection.id,
                        )
                      }
                      className="p-3 hover:bg-[#333] hover:text-white transition-all text-[#333]/40"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {openMenuId === collection.id && (
                      <div className="absolute right-10 mt-3 w-48 bg-white border border-[#333]/10 shadow-2xl z-50 animate-in fade-in zoom-in duration-300 text-left">
                        <Link
                          href={`/admin/collections/${collection.id}/edit`}
                          className="w-full text-left px-6 py-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 flex items-center gap-4 transition-colors border-b border-[#333]/5"
                        >
                          <Edit2 className="w-4 h-4 opacity-70 text-[#333]" />
                          Edit Details
                        </Link>
                        <button className="w-full text-left px-6 py-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-secondary/50 flex items-center gap-4 transition-colors border-b border-[#333]/5">
                          <Archive className="w-4 h-4 opacity-70 text-[#333]" />
                          Archive
                        </button>
                        <button
                          onClick={() => {
                            setCollectionToDelete({
                              id: collection.id,
                              name: collection.name,
                            });
                            setShowDeleteModal(true);
                            setOpenMenuId(null);
                          }}
                          className="w-full text-left px-6 py-4 text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-red-50 text-red-600 flex items-center gap-4 transition-colors"
                        >
                          <Trash2 className="w-4 h-4 opacity-70" />
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
          {filteredCollections.map((collection) => (
            <div
              key={collection.id}
              className="bg-white border border-[#333]/5 shadow-sm group hover:shadow-xl transition-all duration-700 relative overflow-hidden"
            >
              <div className="aspect-video bg-secondary/30 flex items-center justify-center border-b border-[#333]/5">
                <Folder className="w-12 h-12 text-[#333]/10 group-hover:scale-110 transition-transform duration-700" />
              </div>
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-xl font-serif text-[#333] tracking-wide">
                      {collection.name}
                    </h3>
                    <p className="text-[9px] uppercase tracking-[0.3em] font-bold opacity-30">
                      /{collection.slug}
                    </p>
                  </div>
                  <div
                    className={`px-2 py-1 text-[8px] font-bold uppercase tracking-widest ${collection.status === "Active" ? "bg-green-50 text-green-700 border border-green-100" : "bg-amber-50 text-amber-700 border border-amber-100"}`}
                  >
                    {collection.status}
                  </div>
                </div>
                <p className="text-[10px] uppercase tracking-widest leading-relaxed text-[#333]/50 font-bold line-clamp-2">
                  {collection.description}
                </p>
                <div className="flex items-center justify-between pt-6 border-t border-[#333]/5">
                  <div className="flex items-center gap-4">
                    <div className="space-y-1">
                      <p className="text-[8px] uppercase tracking-widest font-bold opacity-30">
                        Products
                      </p>
                      <p className="text-sm font-serif text-[#333] font-bold">
                        {collection.productCount}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/admin/collections/${collection.id}/edit`}
                    className="p-3 bg-secondary hover:bg-[#333] hover:text-white transition-all shadow-sm"
                  >
                    <ArrowUpDown className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info Section */}
      <div className="bg-[#333] p-16 flex flex-col md:flex-row gap-16 items-center shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
          <Layers className="w-64 h-64 text-white" />
        </div>
        <div className="w-24 h-24 bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
          <Layers className="w-10 h-10 text-white" />
        </div>
        <div className="space-y-6 relative z-10">
          <h4 className="text-2xl font-serif uppercase tracking-widest text-white">
            Store Organization
          </h4>
          <p className="text-[10px] text-white/40 leading-relaxed max-w-3xl uppercase tracking-[0.3em] font-bold">
            Organizing your products into collections helps customers find what
            they are looking for more easily. Ensure your categories are clear
            and the names are simple to understand.
          </p>
          <div className="flex gap-8">
            <button className="text-[9px] uppercase tracking-[0.4em] font-bold border-b border-white/20 pb-1 text-white hover:border-white transition-all">
              Organizing Tips
            </button>
            <button className="text-[9px] uppercase tracking-[0.4em] font-bold border-b border-white/20 pb-1 text-white hover:border-white transition-all">
              Download List
            </button>
          </div>
        </div>
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-2xl px-4 animate-in fade-in duration-700">
          <div className="bg-white w-full max-w-2xl p-20 shadow-2xl border border-[#333]/5 relative overflow-hidden">
            <div className="relative z-10 flex flex-col items-center text-center space-y-12">
              <div className="w-20 h-20 bg-red-50 flex items-center justify-center border border-red-100">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <div className="space-y-6">
                <h2 className="text-3xl font-serif uppercase tracking-[0.2em] text-[#333]">
                  Delete Collection
                </h2>
                <div className="p-8 bg-secondary/30 border border-[#333]/5">
                  <p className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-60 leading-loose max-w-sm mx-auto">
                    Are you sure you want to permanently delete this collection?
                    <br />
                    <span className="text-red-600 text-lg font-serif normal-case italic tracking-normal block mt-2">
                      &quot;{collectionToDelete?.name}&quot;
                    </span>
                  </p>
                </div>
                <p className="text-[9px] uppercase tracking-[0.5em] font-bold text-red-600/50">
                  This action cannot be undone and will remove the category from
                  all products.
                </p>
              </div>
              <div className="flex flex-col md:flex-row w-full gap-5 pt-8">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 bg-red-600 text-white py-6 text-[10px] uppercase tracking-[0.5em] font-bold hover:bg-black transition-all duration-700 shadow-xl"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 text-[#333] py-6 text-[10px] uppercase tracking-[0.5em] font-bold border border-[#333]/10 hover:bg-secondary transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
