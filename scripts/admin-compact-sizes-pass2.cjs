/**
 * Second-pass compaction for leftover oversized admin classes.
 */
const fs = require("fs");
const path = require("path");

const roots = [
  path.join(__dirname, "..", "src", "app", "admin"),
  path.join(__dirname, "..", "src", "components", "admin"),
];

const replacements = [
  ["absolute inset-x-0 bottom-0 h-0.5 bg-primary/20", "hidden"],
  ["text-2xl lg:text-3xl font-serif font-bold", "text-lg font-serif font-bold"],
  [
    "text-2xl lg:text-3xl font-serif tracking-normal text-stone-800 font-bold",
    "admin-page-title font-serif text-stone-800",
  ],
  ["text-2xl sm:text-3xl font-serif", "text-lg font-serif"],
  ["text-2xl sm:text-3xl lg:text-4xl font-serif", "text-xl font-serif"],
  [
    "text-2xl font-serif tracking-widest uppercase",
    "text-lg font-serif tracking-widest uppercase",
  ],
  [
    "text-2xl font-serif uppercase tracking-widest",
    "text-lg font-serif uppercase tracking-widest",
  ],
  ["py-6 px-8", "px-4 py-3"],
  ["px-8 py-2.5", "px-4 py-2.5"],
  ["px-8 py-6", "px-4 py-3"],
  ["px-8 py-12", "px-4 py-8"],
  ["px-8", "px-4"],
  ["py-4 lg:py-2.5", "py-2"],
  [
    "w-full input-standard bg-secondary/5 px-5 lg:px-6 py-4 lg:py-2.5",
    "admin-input w-full",
  ],
  ["w-16 h-16", "w-10 h-10"],
  ["p-8 lg:p-12", "p-4 sm:p-5"],
  ["space-y-10", "space-y-5"],
  ["px-6 lg:px-8 py-3 lg:py-4", "px-4 py-2"],
  ["px-6 lg:px-8 py-2", "px-3 py-1.5"],
  [
    "w-full admin-btn-primary rounded-lg py-4 lg:py-2.5 text-[10px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-80 flex items-center justify-center gap-3 border border-primary/20",
    "w-full admin-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-80",
  ],
  [
    "block w-full text-center border border-stone-200 py-4 lg:py-2.5 text-[10px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold hover:bg-secondary/30 transition-all text-stone-800",
    "block w-full text-center admin-btn-secondary",
  ],
  [
    "text-sm lg:text-base tracking-wide text-stone-800",
    "text-sm tracking-wide text-stone-800",
  ],
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
    if (file.endsWith("AdminSidebar.tsx")) continue;
    if (file.endsWith("AdminLayoutContent.tsx")) continue;
    let content = fs.readFileSync(file, "utf8");
    const original = content;
    for (const [from, to] of replacements) {
      content = content.split(from).join(to);
    }
    content = content.replace(/className="([^"]*)"/g, (_, cls) => {
      return `className="${cls.replace(/\s{2,}/g, " ").trim()}"`;
    });
    if (content !== original) {
      fs.writeFileSync(file, content);
      changed++;
      console.log("Updated:", path.relative(process.cwd(), file));
    }
  }
}

console.log(`Done. ${changed} file(s) updated.`);
