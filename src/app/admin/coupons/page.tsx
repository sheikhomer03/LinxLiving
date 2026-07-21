"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Ticket,
  Edit2,
  Trash2,
  MoreHorizontal,
  AlertCircle,
  X,
  Loader2,
  Calendar,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getCoupons, deleteCoupon } from "@/app/actions/coupons";

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [couponToDelete, setCouponToDelete] = useState<any>(null);

  const fetchCoupons = async () => {
    setLoading(true);
    const data = await getCoupons();
    setCoupons(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const filteredCoupons = coupons.filter((c) =>
    c.code.toLowerCase().includes(searchTerm.toLowerCase()),
  );

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

  useEffect(() => {
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

  const handleDeleteClick = (coupon: any) => {
    setCouponToDelete(coupon);
    setShowDeleteModal(true);
    setOpenMenuId(null);
  };

  const confirmDelete = async () => {
    if (!couponToDelete) return;
    setIsDeleting(true);
    try {
      const result = await deleteCoupon(couponToDelete._id);
      if (result.success) {
        toast.success("Coupon deleted successfully");
        fetchCoupons();
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete coupon");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setCouponToDelete(null);
    }
  };

  if (loading && coupons.length === 0) {
    return (
      <div className="min-h-[240px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/10 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="admin-page animate-in fade-in duration-300">
      <header className="admin-page-header">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary">
            Coupons
          </h1>
          <p className="text-[10px] uppercase tracking-[0.12em] font-black opacity-80">
            Manage promotional discounts and offers
          </p>
        </div>
        <Link
          href="/admin/coupons/new"
          className="w-full sm:w-auto admin-btn-primary inline-flex items-center justify-center gap-2 group"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] uppercase tracking-[0.12em] font-bold">
              Add Coupon
            </span>
          </div>

        </Link>
      </header>

      {/* Search Bar */}
      <div className="admin-search flex items-center gap-3">
        <div className="shrink-0">
          <Search className="w-4 h-4 lg:w-5 lg:h-5 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search coupon code..."
            className="w-full bg-transparent placeholder:text-stone-400 text-sm text-stone-800 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Coupons Table */}
      <div className="bg-white admin-panel-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="admin-table-head font-semibold tracking-[0.12em]">
                <th className="px-4 py-2.5">Coupon Code</th>
                <th className="px-4 py-2.5">Discount</th>
                <th className="px-4 py-2.5 text-center">Usage</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {filteredCoupons.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-stone-800"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-12 h-12 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <Ticket className="w-5 h-5 text-primary/60" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-base font-serif font-bold text-primary">
                          No Coupons Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.12em] font-black text-primary/60">
                          {searchTerm
                            ? "Try adjusting your search criteria"
                            : "No coupons have been created yet"}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCoupons.map((coupon) => {
                  const isExpired = new Date(coupon.expiryDate) < new Date();
                  const isLimitReached =
                    coupon.usageLimit && coupon.usedCount >= coupon.usageLimit;
                  const isActive =
                    coupon.isActive && !isExpired && !isLimitReached;

                  return (
                    <tr
                      key={coupon._id}
                      className="group hover:bg-secondary/5 transition-all duration-500"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-secondary/20 flex items-center justify-center border border-stone-200/80">
                            <Ticket className="w-4 h-4 text-stone-500" />
                          </div>
                          <span className="text-sm font-bold tracking-widest text-primary uppercase">
                            {coupon.code}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-serif text-stone-800">
                          {coupon.discountType === "percentage"
                            ? `${coupon.discountAmount}%`
                            : `£${coupon.discountAmount.toLocaleString()}`}
                        </span>
                        <p className="text-[9px] uppercase tracking-widest opacity-80 font-bold mt-1">
                          {coupon.discountType} OFF
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-bold text-stone-800">
                          {coupon.usedCount} / {coupon.usageLimit || "∞"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-stone-500 uppercase tracking-widest">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(coupon.expiryDate).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isActive ? (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              <span className="text-[9px] uppercase tracking-widest font-bold text-green-600">
                                Active
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              <span className="text-[9px] uppercase tracking-widest font-bold text-red-600">
                                {isExpired
                                  ? "Expired"
                                  : isLimitReached
                                    ? "Limit Reached"
                                    : "Inactive"}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => toggleMenu(e, coupon._id)}
                          className="p-3 bg-primary/5 hover:bg-primary hover:text-primary-foreground transition-all shadow-sm border border-primary/10"
                        >
                          <MoreHorizontal className="w-5 h-5" />
                        </button>

                        {openMenuId === coupon._id && (
                          <div
                            className="fixed mt-2 w-40 bg-white border border-primary/10 shadow-2xl z-100 animate-in fade-in zoom-in duration-300 text-left"
                            style={{ top: menuPos.top, right: menuPos.right }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link
                              href={`/admin/coupons/${coupon._id}/edit`}
                              className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.12em] font-bold hover:bg-primary/5 flex items-center gap-4 transition-colors border-b border-primary/5 text-primary"
                            >
                              <Edit2 className="w-4 h-4 opacity-90" />
                              Edit
                            </Link>
                            <button
                              onClick={() => handleDeleteClick(coupon)}
                              className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.12em] font-bold hover:bg-red-50 text-red-600 flex items-center gap-4 transition-colors"
                            >
                              <Trash2 className="w-4 h-4 opacity-90" />
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 admin-modal-overlay"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => !isDeleting && setShowDeleteModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-8 md:p-12 text-center space-y-5">
              <div className="flex justify-center">
                <div className="w-12 h-12 bg-red-50 flex items-center justify-center rounded-full text-red-600">
                  <AlertCircle className="w-8 h-8 opacity-90" />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-lg font-serif tracking-widest uppercase text-primary">
                  Delete Coupon
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed">
                  Confirming removal of coupon{" "}
                  <span className="font-bold text-stone-800">
                    "{couponToDelete?.code}"
                  </span>
                  .<br /> This action cannot be undone.
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="w-full bg-red-600 text-white py-4 text-[11px] uppercase tracking-[0.16em] font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3"
                >
                  {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="text-[10px] uppercase tracking-[0.12em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
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
