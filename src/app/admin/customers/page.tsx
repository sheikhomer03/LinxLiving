"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Mail,
  Trash2,
  Package,
  X,
  AlertTriangle,
  Users,
} from "lucide-react";
import { getCustomers, deleteCustomer } from "@/app/actions/admin";
import { toast } from "sonner";
import { Pagination } from "@/components/admin/Pagination";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, debouncedSearch]);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const result = await getCustomers(
        currentPage,
        itemsPerPage,
        debouncedSearch,
      );
      setCustomers(result.customers);
      setTotalPages(Math.max(1, Math.ceil(result.totalCount / itemsPerPage)));
    } catch (error) {
      toast.error("Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!customerToDelete) return;
    setIsDeleting(true);
    const result = await deleteCustomer(customerToDelete._id);
    if (result.success) {
      toast.success("Customer removed successfully");
      setCustomers(customers.filter((c) => c._id !== customerToDelete._id));
      setShowDeleteModal(false);
      setCustomerToDelete(null);
    } else {
      toast.error("Failed to delete customer");
    }
    setIsDeleting(false);
  };

  const joinedLabel = (createdAt: string) =>
    new Date(createdAt).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });

  return (
    <div className="admin-page animate-in fade-in duration-300">
      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary">
            Customers
          </h1>
        </div>
      </header>

      <div className="admin-search flex items-center gap-3">
        <div className="shrink-0">
          <Search className="w-4 h-4 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search customers..."
            className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {loading && customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4 bg-white admin-panel-elevated">
          <div className="w-8 h-8 border-4 border-primary/10 border-t-primary rounded-full animate-spin" />
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-primary/60">
            Loading...
          </p>
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center space-y-6 py-12 bg-white admin-panel-elevated px-4">
          <div className="w-12 h-12 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10">
            <Users className="w-5 h-5 text-primary/60" />
          </div>
          <div className="space-y-2 text-center">
            <h3 className="text-base font-serif font-bold text-primary">
              No Customers Found
            </h3>
            <p className="text-[10px] uppercase tracking-[0.12em] font-black text-primary/60">
              {searchTerm
                ? "Try adjusting your search criteria"
                : "There are no customers registered yet"}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Mobile / tablet cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
            {customers.map((customer) => (
              <article
                key={customer._id}
                className="bg-white admin-panel-elevated overflow-hidden flex flex-col min-w-0"
              >
                <div className="p-4 flex items-start gap-3 border-b border-stone-100">
                  <div className="w-12 h-12 shrink-0 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center font-serif text-lg text-primary">
                    {(customer.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[13px] font-serif tracking-wide text-stone-800 truncate">
                      {customer.name}
                    </h2>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.12em] font-bold text-stone-500 flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3 h-3 shrink-0" />
                      <span className="truncate normal-case tracking-normal font-medium">
                        {customer.email}
                      </span>
                    </p>
                    <p className="mt-2 text-[9px] uppercase tracking-[0.14em] font-bold text-stone-400">
                      Joined {joinedLabel(customer.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="p-3 mt-auto flex items-center gap-2">
                  <Link
                    href={`/admin/customers/${customer._id}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 text-[10px] uppercase tracking-widest font-bold text-stone-700 hover:bg-white hover:border-primary/30 transition-colors"
                  >
                    <Package className="w-3.5 h-3.5" />
                    Orders
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerToDelete(customer);
                      setShowDeleteModal(true);
                    }}
                    className="inline-flex items-center justify-center rounded-md border border-red-200/80 bg-red-50/50 px-3 py-2.5 text-red-600 hover:bg-red-50 transition-colors"
                    aria-label={`Delete ${customer.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block bg-white admin-panel-elevated overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="admin-table-head font-semibold tracking-[0.12em]">
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">Joined</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {customers.map((customer) => (
                    <tr
                      key={customer._id}
                      className="group hover:bg-secondary/5 transition-all duration-500"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-14 h-14 bg-primary/5 flex items-center justify-center font-serif text-lg text-primary/40 border border-primary/10 shrink-0 transition-all duration-700 shadow-sm group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary">
                            {customer.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-base font-serif tracking-wide text-stone-800 truncate">
                              {customer.name}
                            </p>
                            <p className="text-[10px] uppercase tracking-[0.16em] font-bold opacity-90 mt-1 flex items-center gap-2 truncate">
                              <Mail className="w-2.5 h-2.5 shrink-0" />{" "}
                              {customer.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] uppercase tracking-[0.16em] font-bold text-stone-500">
                        {joinedLabel(customer.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/admin/customers/${customer._id}`}
                            className="inline-flex items-center gap-3 px-6 py-3 bg-primary/5 border border-primary/10 hover:bg-primary hover:text-primary-foreground transition-all shadow-sm text-[10px] uppercase tracking-widest font-bold text-primary"
                          >
                            <Package className="w-4 h-4" />
                            Orders
                          </Link>
                          <button
                            onClick={() => {
                              setCustomerToDelete(customer);
                              setShowDeleteModal(true);
                            }}
                            className="inline-flex p-3 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-all shadow-sm"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 ? (
            <div className="bg-white admin-panel-elevated overflow-hidden">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                className="border-t-0 px-3 sm:px-4 py-3"
              />
            </div>
          ) : null}
        </>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 admin-modal-overlay"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />

          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => !isDeleting && setShowDeleteModal(false)}
              disabled={isDeleting}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10 disabled:opacity-80"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 md:p-12 text-center space-y-5">
              <div className="flex justify-center">
                <div className="w-12 h-12 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertTriangle className="w-8 h-8 text-red-600 opacity-90" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-lg font-serif tracking-widest uppercase text-stone-800">
                  Revoke Access
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Remove{" "}
                  <span className="font-bold text-stone-800">
                    &quot;{customerToDelete?.name}&quot;
                  </span>
                  ?
                  <br /> Personal profile data will be permanently purged.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.16em] font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3"
                >
                  {isDeleting && (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  )}
                  Authorize Deletion
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.12em] font-bold opacity-80 hover:opacity-100 transition-opacity pt-2"
                >
                  Cancel
                </button>
              </div>
            </div>

            <div className="h-1.5 w-full bg-linear-to-r from-red-600/20 via-red-600/10 to-transparent" />
          </div>
        </div>
      )}
    </div>
  );
}
