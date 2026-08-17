"use client";

import { useEffect } from "react";

/**
 * Nothing in this catalogue/admin app has a legitimate use for a negative
 * number (price, stock, area, quantity, discount, wattage — all zero or
 * above), so this blocks "-" app-wide rather than fixing each input one by
 * one. Skips any field that explicitly declares a negative `min` — there
 * are none today, but this keeps the guard from ever fighting a field that
 * legitimately needs one.
 */
function isNonNegativeNumberInput(
  target: EventTarget | null,
): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement) || target.type !== "number") {
    return false;
  }
  return target.min === "" || Number(target.min) >= 0;
}

export function DisableNegativeNumberInput() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        (e.key === "-" || e.key === "Subtract") &&
        isNonNegativeNumberInput(e.target)
      ) {
        e.preventDefault();
      }
    }

    function handlePaste(e: ClipboardEvent) {
      if (!isNonNegativeNumberInput(e.target)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim().startsWith("-")) {
        e.preventDefault();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("paste", handlePaste);
    };
  }, []);

  return null;
}
