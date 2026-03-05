"use client";

import React, { useState } from "react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";

import { useCheckoutStore } from "@/store/useCheckoutStore";

interface StepProps {
  onNext: () => void;
}

export function CheckoutInformation({ onNext }: StepProps) {
  const { email, shippingAddress, setEmail, setShippingAddress } =
    useCheckoutStore();
  const [formData, setFormData] = useState({
    email: email || "",
    firstName: shippingAddress.firstName || "",
    lastName: shippingAddress.lastName || "",
    address: shippingAddress.address || "",
    city: shippingAddress.city || "",
    postcode: shippingAddress.postcode || "",
    company: shippingAddress.company || "",
    address2: shippingAddress.address2 || "",
    county: shippingAddress.county || "",
    country: shippingAddress.country || "United Kingdom",
    phone: shippingAddress.phone || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.email) newErrors.email = "EMAIL IS REQUIRED";
    else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(formData.email))
      newErrors.email = "INVALID EMAIL FORMAT";
    if (!formData.firstName) newErrors.firstName = "FIRST NAME IS REQUIRED";
    if (!formData.lastName) newErrors.lastName = "LAST NAME IS REQUIRED";
    if (!formData.address) newErrors.address = "ADDRESS LINE 1 IS REQUIRED";
    if (!formData.city) newErrors.city = "CITY IS REQUIRED";
    if (!formData.postcode) newErrors.postcode = "POSTCODE IS REQUIRED";
    else if (!/^[A-Z0-9\s]{3,10}$/i.test(formData.postcode))
      newErrors.postcode = "INVALID POSTCODE FORMAT";
    if (!formData.phone) newErrors.phone = "PHONE NUMBER IS REQUIRED";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      setEmail(formData.email);
      setShippingAddress({
        firstName: formData.firstName,
        lastName: formData.lastName,
        address: formData.address,
        city: formData.city,
        postcode: formData.postcode,
        company: formData.company,
        address2: formData.address2,
        county: formData.county,
        country: formData.country,
        phone: formData.phone,
      });
      onNext();
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-12 animate-in fade-in duration-500"
    >
      <div className="space-y-6">
        <div className="flex justify-between items-baseline">
          <h2 className="text-lg font-serif uppercase tracking-widest text-[#333]">
            Contact Information
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">
            Step 1 of 3
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div
              className={`input-standard ${errors.email ? "border-red-500!" : ""}`}
            >
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Email Address"
                className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
              />
            </div>
            {errors.email && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest font-sans">
                {errors.email}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <div
              className={`input-standard phone-input-container ${errors.phone ? "border-red-500!" : ""}`}
            >
              <PhoneInput
                international
                defaultCountry="GB"
                value={formData.phone}
                onChange={(value) => {
                  setFormData((prev) => ({ ...prev, phone: value || "" }));
                  if (errors.phone) {
                    setErrors((prev) => ({ ...prev, phone: "" }));
                  }
                }}
                placeholder="Phone Number"
                className="w-full px-4 py-4 text-sm bg-white outline-none luxury-phone-input"
              />
            </div>
            {errors.phone && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest font-sans">
                {errors.phone}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <h2 className="text-lg font-serif uppercase tracking-widest text-[#333]">
          Shipping Address
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div
              className={`input-standard ${errors.firstName ? "border-red-500!" : ""}`}
            >
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                placeholder="First Name"
                className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
              />
            </div>
            {errors.firstName && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
                {errors.firstName}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <div
              className={`input-standard ${errors.lastName ? "border-red-500!" : ""}`}
            >
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                placeholder="Last Name"
                className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
              />
            </div>
            {errors.lastName && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
                {errors.lastName}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="input-standard">
            <input
              type="text"
              name="company"
              value={formData.company}
              onChange={handleChange}
              placeholder="Company (Optional)"
              className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
            />
          </div>
          <div className="relative group input-standard">
            <select
              name="country"
              value={formData.country}
              onChange={handleChange}
              className="w-full px-4 py-4 text-sm appearance-none bg-white transition-all cursor-pointer outline-none"
            >
              <option value="United Kingdom">United Kingdom</option>
              <option value="Ireland">Ireland</option>
              <option value="France">France</option>
              <option value="United States">United States</option>
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                ></path>
              </svg>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <div
              className={`input-standard ${errors.address ? "border-red-500!" : ""}`}
            >
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Address Line 1"
                className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
              />
            </div>
            {errors.address && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
                {errors.address}
              </p>
            )}
          </div>

          <div className="input-standard">
            <input
              type="text"
              name="address2"
              value={formData.address2}
              onChange={handleChange}
              placeholder="Address Line 2 (Optional)"
              className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <div
              className={`input-standard ${errors.city ? "border-red-500!" : ""}`}
            >
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="City"
                className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
              />
            </div>
            {errors.city && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
                {errors.city}
              </p>
            )}
          </div>
          <div className="input-standard">
            <input
              type="text"
              name="county"
              value={formData.county}
              onChange={handleChange}
              placeholder="County (Optional)"
              className="w-full px-4 py-4 text-sm transition-all placeholder:text-foreground/30 outline-none"
            />
          </div>
          <div className="space-y-1">
            <div
              className={`input-standard ${errors.postcode ? "border-red-500!" : ""}`}
            >
              <input
                type="text"
                name="postcode"
                value={formData.postcode}
                onChange={handleChange}
                placeholder="Postcode"
                className="w-full px-4 py-4 text-sm transition-all bg-white placeholder:text-foreground/30 outline-none"
              />
            </div>
            {errors.postcode && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">
                {errors.postcode}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 border-t border-foreground/5">
        <Link
          href="/cart"
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Cart
        </Link>
        <button
          type="submit"
          className="w-full md:w-auto px-12 py-5 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-black/5"
        >
          Continue to Shipping
        </button>
      </div>
    </form>
  );
}
