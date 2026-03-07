"use client";
import React, { useState, useEffect } from "react";
import {
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
} from "@/actions/address";
import { toast } from "sonner";
import { AddressBookSkeleton } from "./ProfileSkeletons";
import SpinnerLoader from "@/components/common/SpinnerLoader";
import ConfirmationModal from "@/components/common/ConfirmationModal";

interface AddressData {
  _id: string;
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  county?: string;
  postcode: string;
  country: string;
  isDefault: boolean;
}

export function AddressBook() {
  const [view, setView] = useState<"list" | "add" | "edit">("list");
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    company: "",
    address1: "",
    address2: "",
    city: "",
    county: "",
    postcode: "",
    country: "United Kingdom",
  });

  useEffect(() => {
    fetchAddresses();
  }, []);

  const fetchAddresses = async () => {
    setLoading(true);
    const result = await getAddresses();
    if (result.success) {
      setAddresses(result.addresses);
    } else {
      toast.error(result.error || "Failed to load addresses");
    }
    setLoading(false);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData({
      firstName: "",
      lastName: "",
      company: "",
      address1: "",
      address2: "",
      city: "",
      county: "",
      postcode: "",
      country: "United Kingdom",
    });
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const result = editingId
        ? await updateAddress(editingId, formData)
        : await addAddress(formData);

      if (result.success) {
        toast.success(
          editingId
            ? "Address updated successfully"
            : "Address added successfully",
        );
        resetForm();
        setView("list");
        fetchAddresses();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (address: AddressData) => {
    setFormData({
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company || "",
      address1: address.address1,
      address2: address.address2 || "",
      city: address.city,
      county: address.county || "",
      postcode: address.postcode,
      country: address.country,
    });
    setEditingId(address._id);
    setView("edit");
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    setIsDeleting(true);

    try {
      const result = await deleteAddress(pendingDeleteId);
      if (result.success) {
        toast.success("Address removed from your collection");
        fetchAddresses();
        setShowDeleteModal(false);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsDeleting(false);
      setPendingDeleteId(null);
    }
  };

  if (view === "add" || view === "edit") {
    return (
      <div className="space-y-8 animate-in slide-in-from-right duration-500 max-w-2xl">
        <h3 className="text-xl font-serif tracking-widest uppercase">
          {view === "add" ? "Add New Address" : "Edit Address"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold">First Name:</label>
              <div className="input-standard">
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  placeholder="Your First Name"
                  className="w-full px-4 py-3 text-sm outline-none"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold">Last Name:</label>
              <div className="input-standard">
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  placeholder="Your Last Name"
                  className="w-full px-4 py-3 text-sm outline-none"
                  required
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold">Company:</label>
            <div className="input-standard">
              <input
                type="text"
                name="company"
                value={formData.company}
                onChange={handleInputChange}
                placeholder="Company (Optional)"
                className="w-full px-4 py-3 text-sm outline-none"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold">Address Line 1:</label>
            <div className="input-standard">
              <input
                type="text"
                name="address1"
                value={formData.address1}
                onChange={handleInputChange}
                placeholder="Address Line 1"
                className="w-full px-4 py-3 text-sm outline-none"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold">Address Line 2:</label>
            <div className="input-standard">
              <input
                type="text"
                name="address2"
                value={formData.address2}
                onChange={handleInputChange}
                placeholder="Address Line 2 (optional)"
                className="w-full px-4 py-3 text-sm outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold">City:</label>
              <div className="input-standard">
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  placeholder="City"
                  className="w-full px-4 py-3 text-sm outline-none"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold">County:</label>
              <div className="input-standard">
                <input
                  type="text"
                  name="county"
                  value={formData.county}
                  onChange={handleInputChange}
                  placeholder="County (optional)"
                  className="w-full px-4 py-3 text-sm outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold">Postcode:</label>
              <div className="input-standard">
                <input
                  type="text"
                  name="postcode"
                  value={formData.postcode}
                  onChange={handleInputChange}
                  placeholder="Postcode"
                  className="w-full px-4 py-3 text-sm outline-none"
                  required
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-bold">Country:</label>
            <div className="input-standard">
              <select
                name="country"
                value={formData.country}
                onChange={handleInputChange}
                className="w-full px-4 py-3 text-sm outline-none bg-white"
              >
                <option>United Kingdom</option>
                <option>Ireland</option>
                <option>France</option>
                <option>United States</option>
                <option>Pakistan</option>
              </select>
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={submitting}
              className="px-12 h-14 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-[#1a1a1a] transition-all flex items-center justify-center min-w-[200px]"
            >
              {submitting ? (
                <SpinnerLoader className="w-6! h-6!" />
              ) : view === "add" ? (
                "Add New Address"
              ) : (
                "Update Address"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setView("list");
              }}
              className="px-12 h-14 border border-foreground/10 uppercase tracking-widest text-[11px] font-bold hover:bg-secondary/50 transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <h3 className="text-xl font-serif tracking-widest uppercase">
        Address Book
      </h3>

      {loading ? (
        <AddressBookSkeleton />
      ) : addresses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {addresses.map((address, index) => (
            <div
              key={address._id}
              className="border border-foreground/10 p-6 space-y-4 relative group"
            >
              <div className="flex justify-between items-start">
                <p className="text-[11px] font-bold opacity-80 uppercase tracking-widest">
                  Address {index + 1} {address.isDefault && "(Default)"}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleEdit(address)}
                    className="text-[11px] font-bold underline uppercase tracking-widest hover:opacity-80"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(address._id)}
                    className="text-[11px] font-bold underline uppercase tracking-widest text-red-600 hover:opacity-80"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="text-sm font-sans leading-relaxed">
                <p className="font-bold">
                  {address.firstName} {address.lastName}
                </p>
                {address.company && <p>{address.company}</p>}
                <p>{address.address1}</p>
                {address.address2 && <p>{address.address2}</p>}
                <p>
                  {address.city}
                  {address.county && `, ${address.county}`}
                </p>
                <p>{address.postcode}</p>
                <p>{address.country}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-2">
          <p className="text-sm font-sans">You have no addresses</p>
        </div>
      )}

      <div className="pt-6">
        <button
          onClick={() => {
            resetForm();
            setView("add");
          }}
          className="px-12 h-14 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-[#1a1a1a] transition-colors flex items-center justify-center min-w-[200px]"
        >
          Add New Address
        </button>
      </div>
      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={confirmDelete}
        title="Remove Address"
        message="Are you sure you wish to remove this address from your collection? This action cannot be undone."
        confirmLabel="Remove Address"
        isLoading={isDeleting}
      />
    </div>
  );
}
