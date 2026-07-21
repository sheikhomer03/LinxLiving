/**
 * Compact oversized admin UI classes to normal density.
 * Usage: node scripts/admin-compact-sizes.cjs
 */
const fs = require("fs");
const path = require("path");

const roots = [
  path.join(__dirname, "..", "src", "app", "admin"),
  path.join(__dirname, "..", "src", "components", "admin"),
];

const replacements = [
  // Page spacing
  ["space-y-10 lg:space-y-12 pb-32", "admin-page"],
  ["space-y-10 lg:space-y-12", "admin-page"],
  ["space-y-8 lg:space-y-12", "admin-page"],
  ["space-y-8 lg:space-y-10", "space-y-5"],
  ["space-y-8", "space-y-5"],
  ["animate-in fade-in duration-1000", "animate-in fade-in duration-300"],
  ["animate-in fade-in duration-700", "animate-in fade-in duration-300"],
  ["pb-32", "pb-8"],
  ["pb-20", "pb-8"],

  // Headers
  [
    "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-8",
    "admin-page-header",
  ],
  [
    "text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold uppercase",
    "admin-page-title font-serif text-primary uppercase",
  ],
  [
    "text-2xl lg:text-3xl font-serif tracking-normal text-primary font-bold",
    "admin-page-title font-serif text-primary",
  ],
  [
    "text-2xl sm:text-3xl lg:text-4xl font-serif tracking-wide text-stone-800",
    "text-xl sm:text-2xl font-serif tracking-wide text-stone-800",
  ],
  [
    "text-2xl lg:text-3xl font-serif tracking-wide text-stone-800",
    "admin-page-title font-serif text-stone-800",
  ],

  // Primary action buttons (oversized)
  [
    "w-full sm:w-auto admin-btn-primary rounded-lg px-8 lg:px-10 py-3.5 lg:py-4 transition-all shadow-xl flex items-center justify-center gap-4 group overflow-hidden relative border border-primary/20",
    "w-full sm:w-auto admin-btn-primary inline-flex items-center justify-center gap-2 group",
  ],
  [
    "admin-btn-primary rounded-lg px-8 lg:px-10 py-3.5 lg:py-4 transition-all shadow-xl flex items-center justify-center gap-4 group overflow-hidden relative border border-primary/20",
    "admin-btn-primary inline-flex items-center justify-center gap-2 group",
  ],
  [
    "px-8 lg:px-10 py-3.5 lg:py-4",
    "px-4 py-2",
  ],
  [
    "px-8 py-4",
    "px-4 py-2",
  ],
  [
    "px-8 py-3.5",
    "px-4 py-2",
  ],
  [
    "relative z-10 flex items-center gap-4",
    "relative z-10 flex items-center gap-2",
  ],
  [
    "text-[10px] lg:text-[11px] uppercase tracking-[0.4em] font-black",
    "text-[10px] uppercase tracking-[0.2em] font-bold",
  ],
  [
    "text-[10px] uppercase tracking-[0.4em] font-black",
    "text-[10px] uppercase tracking-[0.2em] font-bold",
  ],
  [
    "text-[9px] lg:text-[10px] uppercase tracking-[0.4em] font-bold",
    "text-[10px] uppercase tracking-[0.2em] font-bold",
  ],
  ["shadow-xl", "shadow-sm"],
  ["shadow-lg", "shadow-sm"],

  // Search bars
  [
    "admin-search px-6 py-3 flex items-center gap-4 lg:gap-6 mb-5 lg:mb-12",
    "admin-search flex items-center gap-3",
  ],
  [
    "admin-search px-6 py-3 flex items-center gap-4 lg:gap-6",
    "admin-search flex items-center gap-3",
  ],
  [
    "placeholder:text-stone-500 text-base lg:text-lg font-serif tracking-wide text-stone-800",
    "placeholder:text-stone-400 text-sm text-stone-800",
  ],
  [
    "placeholder:text-stone-500 text-base lg:text-lg font-serif tracking-wide",
    "placeholder:text-stone-400 text-sm",
  ],
  ["w-5 h-5 text-primary", "w-4 h-4 text-primary"],

  // Table heads / cells
  [
    "admin-table-head font-semibold text-[11px] lg:text-[12px] uppercase tracking-[0.2em] py-5 px-6 lg:px-10",
    "admin-table-head font-semibold tracking-[0.12em] py-2.5 px-4",
  ],
  [
    "admin-table-head font-semibold text-[11px] lg:text-[12px] uppercase tracking-[0.2em]",
    "admin-table-head font-semibold tracking-[0.12em]",
  ],
  [
    "text-[11px] lg:text-[12px] uppercase tracking-[0.2em]",
    "text-[10px] uppercase tracking-[0.12em]",
  ],
  ["px-6 lg:px-10 py-5 lg:py-6", "px-4 py-3"],
  ["px-6 lg:px-10 py-5", "px-4 py-2.5"],
  ["px-6 lg:px-10 py-4", "px-4 py-3"],
  ["px-6 lg:px-10", "px-4"],
  ["py-5 lg:py-6", "py-3"],
  ["py-5", "py-2.5"],
  ["gap-4 lg:gap-8", "gap-3"],
  ["gap-4 lg:gap-6", "gap-3"],
  ["gap-6 sm:gap-8", "gap-3"],
  ["gap-6 lg:gap-8", "gap-3"],

  // Modal / form buttons
  [
    "admin-btn-primary rounded-lg py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:opacity-90",
    "admin-btn-primary",
  ],
  [
    "admin-btn-primary rounded-lg py-4 text-[10px] uppercase tracking-[0.3em] font-bold",
    "admin-btn-primary",
  ],
  [
    "admin-btn-primary rounded-lg py-5 text-[10px] uppercase tracking-[0.3em] font-bold",
    "admin-btn-primary",
  ],
  [
    "flex-1 admin-btn-primary rounded-lg py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:opacity-90 transition-all shadow-sm flex items-center justify-center gap-3",
    "flex-1 admin-btn-primary inline-flex items-center justify-center gap-2",
  ],
  [
    "flex-1 admin-btn-primary rounded-lg py-4 text-[10px] uppercase tracking-[0.3em] font-bold flex items-center justify-center gap-3",
    "flex-1 admin-btn-primary inline-flex items-center justify-center gap-2",
  ],
  [
    "w-full admin-btn-primary rounded-lg py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20",
    "w-full admin-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-80",
  ],
  [
    "admin-btn-primary rounded-lg py-4 lg:py-5 text-[10px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20",
    "admin-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-80",
  ],
  ["py-4 lg:py-5", "py-2.5"],
  ["py-3.5 lg:py-4", "py-2"],
  ["p-6 sm:p-10 lg:p-12", "p-4 sm:p-6"],
  ["p-6 lg:p-8", "p-4 sm:p-5"],
  ["p-8 lg:p-10", "p-5"],
  ["p-6 lg:p-10", "p-4 sm:p-5"],
  ["space-y-8 lg:space-y-12", "space-y-5"],
  ["mb-5 lg:mb-12", ""],
  ["mb-8", "mb-4"],
  ["min-h-[400px]", "min-h-[240px]"],
  ["py-20 lg:py-32", "py-12"],
  ["py-20", "py-12"],
  ["w-20 h-20", "w-12 h-12"],
  ["w-10 h-10 text-primary/60", "w-5 h-5 text-primary/60"],
  ["text-xl font-serif font-bold", "text-base font-serif font-bold"],
  ["tracking-[0.3em]", "tracking-[0.16em]"],
  ["tracking-[0.4em]", "tracking-[0.18em]"],
  ["tracking-[0.2em]", "tracking-[0.12em]"],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

let changed = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    // Sidebar + layout handled separately for finer control
    if (file.endsWith("AdminSidebar.tsx")) continue;
    if (file.endsWith("AdminLayoutContent.tsx")) continue;
    let content = fs.readFileSync(file, "utf8");
    const original = content;
    for (const [from, to] of replacements) {
      content = content.split(from).join(to);
    }
    // Clean double spaces left by empty replacements
    content = content.replace(/className="([^"]*)"/g, (_, cls) => {
      const cleaned = cls.replace(/\s{2,}/g, " ").trim();
      return `className="${cleaned}"`;
    });
    if (content !== original) {
      fs.writeFileSync(file, content);
      changed++;
      console.log("Updated:", path.relative(process.cwd(), file));
    }
  }
}

console.log(`Done. ${changed} file(s) updated.`);
