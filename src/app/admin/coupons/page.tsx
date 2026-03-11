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
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/10 border-t-primary animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10 lg:space-y-12 pb-32 animate-in fade-in duration-1000">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold">
            Coupons
          </h1>
          <p className="text-[10px] uppercase tracking-[0.2em] font-black opacity-80">
            Manage promotional discounts and offers
          </p>
        </div>
        <Link
          href="/admin/coupons/new"
          className="w-full sm:w-auto bg-[#1a1a1a] hover:bg-black text-primary px-8 lg:px-10 py-3.5 lg:py-4 transition-all shadow-xl flex items-center justify-center gap-4 group overflow-hidden relative border border-primary/20"
        >
          <div className="relative z-10 flex items-center gap-4">
            <Plus className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180" />
            <span className="text-[10px] lg:text-[11px] uppercase tracking-[0.4em] font-black">
              Add Coupon
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/20" />
        </Link>
      </header>

      {/* Search Bar */}
      <div className="bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-[#333]/5 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12">
        <div className="shrink-0">
          <Search className="w-4 h-4 lg:w-5 lg:h-5 text-primary group-focus-within:text-primary transition-colors" />
        </div>
        <div className="grow min-w-0">
          <input
            type="search"
            placeholder="Search coupon code..."
            className="w-full bg-transparent placeholder:text-[#333]/60 text-base lg:text-lg font-serif tracking-wide text-[#333] outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Coupons Table */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-[#1a1a1a] text-primary font-black text-[11px] lg:text-[12px] uppercase tracking-[0.2em]">
                <th className="px-6 lg:px-10 py-5">Coupon Code</th>
                <th className="px-6 lg:px-10 py-5">Discount</th>
                <th className="px-6 lg:px-10 py-5 text-center">Usage</th>
                <th className="px-6 lg:px-10 py-5">Expires</th>
                <th className="px-6 lg:px-10 py-5">Status</th>
                <th className="px-6 lg:px-10 py-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/10">
              {filteredCoupons.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-20 lg:py-32 text-center text-[#333]"
                  >
                    <div className="flex flex-col items-center justify-center space-y-6">
                      <div className="w-20 h-20 bg-primary/5 flex items-center justify-center rounded-full border border-primary/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
                        <Ticket className="w-10 h-10 text-primary/60" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-serif font-bold text-primary">
                          No Coupons Found
                        </h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-black text-primary/60">
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
                      <td className="px-6 lg:px-10 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-secondary/20 flex items-center justify-center border border-[#333]/5">
                            <Ticket className="w-4 h-4 text-[#333]/60" />
                          </div>
                          <span className="text-sm font-bold tracking-widest text-primary uppercase">
                            {coupon.code}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 lg:px-10 py-6">
                        <span className="text-sm font-serif text-[#333]">
                          {coupon.discountType === "percentage"
                            ? `${coupon.discountAmount}%`
                            : `£${coupon.discountAmount.toLocaleString()}`}
                        </span>
                        <p className="text-[9px] uppercase tracking-widest opacity-80 font-bold mt-1">
                          {coupon.discountType} OFF
                        </p>
                      </td>
                      <td className="px-6 lg:px-10 py-6 text-center">
                        <span className="text-sm font-bold text-[#333]">
                          {coupon.usedCount} / {coupon.usageLimit || "∞"}
                        </span>
                      </td>
                      <td className="px-6 lg:px-10 py-6">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-[#333]/60 uppercase tracking-widest">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(coupon.expiryDate).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 lg:px-10 py-6">
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
                      <td className="px-6 lg:px-10 py-6 text-right">
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
                              className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold hover:bg-primary/5 flex items-center gap-4 transition-colors border-b border-primary/5 text-primary"
                            >
                              <Edit2 className="w-4 h-4 opacity-90" />
                              Edit
                            </Link>
                            <button
                              onClick={() => handleDeleteClick(coupon)}
                              className="w-full text-left px-6 py-4 text-[12px] uppercase tracking-[0.2em] font-bold hover:bg-red-50 text-red-600 flex items-center gap-4 transition-colors"
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
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !isDeleting && setShowDeleteModal(false)}
          />
          <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => !isDeleting && setShowDeleteModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-8 md:p-12 text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 flex items-center justify-center rounded-full text-red-600">
                  <AlertCircle className="w-8 h-8 opacity-90" />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl font-serif tracking-widest uppercase text-primary">
                  Delete Coupon
                </h2>
                <p className="text-sm text-foreground/60 leading-relaxed">
                  Confirming removal of coupon{" "}
                  <span className="font-bold text-[#333]">
                    "{couponToDelete?.code}"
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
          </div>
        </div>
      )}
    </div>
  );
}
