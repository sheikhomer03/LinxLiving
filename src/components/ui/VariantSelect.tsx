"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type VariantSelectOption = {
  value: string;
  label: string;
  /** Secondary text on the right, e.g. a price. */
  hint?: string;
  /** Shown but marked, and still selectable — the supplier lists them too. */
  unavailable?: boolean;
};

/**
 * Styled dropdown for product variant choices.
 *
 * A native <select> cannot style its option list, so this is a button plus
 * listbox with the usual keyboard handling (arrows, Home/End, Enter, Escape,
 * type-ahead).
 */
export function VariantSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  options: VariantSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const autoId = useId();
  const buttonId = id || `variant-select-${autoId}`;
  const listId = `${buttonId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    if (disabled || !options.length) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) return openList();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => Math.min(last, Math.max(0, i + step)));
        return;
      }
      case "Home":
      case "End":
        if (!open) return;
        e.preventDefault();
        setActive(e.key === "Home" ? 0 : last);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(active);
        else openList();
        return;
      case "Escape":
      case "Tab":
        setOpen(false);
        return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const now = Date.now();
          const t = typed.current;
          t.text = (now - t.at > 600 ? "" : t.text) + e.key.toLowerCase();
          t.at = now;
          const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
          if (hit < 0) return;
          if (open) setActive(hit);
          else if (options[hit].value !== value) onChange(options[hit].value);
        }
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={buttonId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "group relative flex h-12 w-full items-center gap-3 border-0 border-b-2 bg-transparent px-0 text-left text-[15px] transition-colors duration-200",
          "focus:outline-none",
          open
            ? "border-foreground"
            : "border-foreground/15 hover:border-foreground/60 focus-visible:border-foreground",
          disabled && "cursor-not-allowed opacity-50 hover:border-foreground/15",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <span className={cn("font-semibold text-foreground", selected.unavailable && "text-foreground/45")}>
              {selected.label}
            </span>
          ) : (
            <span className="text-foreground/40">{placeholder}</span>
          )}
        </span>
        {selected?.hint ? (
          <span className="shrink-0 text-sm font-semibold text-foreground">{selected.hint}</span>
        ) : null}
        {selected?.unavailable ? (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-foreground/45">
            Unavailable
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "h-4.5 w-4.5 shrink-0 text-foreground/50 transition-transform duration-300 ease-out group-hover:text-foreground",
            open && "rotate-180 text-foreground",
          )}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={buttonId}
          className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-y-auto overscroll-contain rounded-md bg-white py-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.22),0_2px_6px_-2px_rgba(0,0,0,0.08)] ring-1 ring-black/5"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isActive = index === active;
            return (
              <li
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(index)}
                className={cn(
                  "relative flex cursor-pointer items-center gap-3 py-3 pl-5 pr-4 text-sm transition-colors duration-100",
                  "before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:bg-foreground before:transition-opacity",
                  isSelected ? "before:opacity-100" : "before:opacity-0",
                  isActive ? "bg-[#f4f2ed]" : isSelected ? "bg-[#faf8f3]" : "bg-white",
                )}
              >
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    isSelected ? "font-semibold text-foreground" : "text-foreground/80",
                    isActive && !isSelected && "text-foreground",
                    option.unavailable && "text-foreground/35 line-through decoration-foreground/25",
                  )}
                >
                  {option.label}
                </span>
                {option.unavailable ? (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-foreground/35">
                    Unavailable
                  </span>
                ) : option.hint ? (
                  <span className={cn("shrink-0 text-sm", isSelected ? "font-semibold text-foreground" : "font-medium text-foreground/70")}>
                    {option.hint}
                  </span>
                ) : null}
                <Check
                  className={cn("h-4 w-4 shrink-0", isSelected ? "text-foreground" : "invisible")}
                  strokeWidth={2.5}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
