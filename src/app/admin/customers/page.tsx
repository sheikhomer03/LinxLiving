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

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    const data = await getCustomers();
    setCustomers(data);
    setLoading(false);
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

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="space-y-10 lg:space-y-12 pb-32 animate-in fade-in duration-1000">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
            Customers
          </h1>
        </div>
      </header>

      {/* Search Bar */}
      <div className="bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-[#333]/5 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12">
        <div className="shrink-0">
          <Search className="w-4 h-4 lg:w-5 h-5 text-[#333] group-focus-within:text-[#333] transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search customers..."
            className="w-full bg-transparent placeholder:text-[#333]/60 text-base lg:text-lg font-serif tracking-wide text-[#333] outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-[#333] text-white font-black text-[11px] lg:text-[12px] uppercase tracking-[0.2em]">
                <th className="px-6 lg:px-10 py-5">Customer</th>
                <th className="px-6 lg:px-10 py-5">Joined</th>
                <th className="px-6 lg:px-10 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/10">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 lg:px-10 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-8 h-8 border-4 border-[#333]/10 border-t-[#333] rounded-full animate-spin" />
                      <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-30">
                        Loading...
                      </p>
                    </div>
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-6 py-20 lg:py-32 text-center text-[#333]"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-20 h-20 bg-secondary/10 flex items-center justify-center rounded-full border border-[#333]/5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <Users className="w-10 h-10 opacity-20 text-[#333]" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-serif font-bold">
                          No Customers Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-black opacity-40">
                          {searchTerm
                            ? "Try adjusting your search criteria"
                            : "There are no customers registered yet"}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr
                    key={customer._id}
                    className="group hover:bg-secondary/5 transition-all duration-500"
                  >
                    <td className="px-6 lg:px-10 py-6 lg:py-8">
                      <div className="flex items-center gap-4 lg:gap-8">
                        <div className="w-10 h-10 lg:w-14 lg:h-14 bg-secondary/30 flex items-center justify-center font-serif text-base lg:text-lg text-[#333]/40 border border-[#333]/5 shrink-0 transition-all duration-700 shadow-sm group-hover:bg-[#333] group-hover:text-white">
                          {customer.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm lg:text-base font-serif tracking-wide text-[#333] truncate">
                            {customer.name}
                          </p>
                          <p className="text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold opacity-30 mt-1 flex items-center gap-2 truncate">
                            <Mail className="w-2.5 h-2.5 shrink-0" />{" "}
                            {customer.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] font-bold text-[#333]/50">
                      {new Date(customer.createdAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          year: "numeric",
                        },
                      )}
                    </td>
                    <td className="px-6 lg:px-10 py-6 lg:py-8 text-right">
                      <div className="flex items-center justify-end gap-2 lg:gap-4">
                        <Link
                          href={`/admin/customers/${customer._id}`}
                          className="inline-flex items-center gap-2 lg:gap-3 px-4 lg:px-6 py-2.5 lg:py-3 bg-secondary/10 hover:bg-[#333] hover:text-white transition-all shadow-sm text-[9px] lg:text-[10px] uppercase tracking-widest font-bold"
                        >
                          <Package className="w-4 h-4" />
                          <span className="hidden sm:inline">Orders</span>
                        </Link>
                        <button
                          onClick={() => {
                            setCustomerToDelete(customer);
                            setShowDeleteModal(true);
                          }}
                          className="inline-flex p-2.5 lg:p-3 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-all shadow-sm"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
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
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full">
                  <AlertTriangle className="w-8 h-8 text-red-600 opacity-60" />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-[#333]">
                  Revoke Access
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed font-sans">
                  Remove{" "}
                  <span className="font-bold text-[#333]">
                    "{customerToDelete?.name}"
                  </span>
                  ?
                  <br /> Personal profile data will be permanently purged.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.3em] font-bold hover:bg-red-700 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {isDeleting && (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  )}
                  Authorize Deletion
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 hover:opacity-100 transition-opacity pt-2"
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
