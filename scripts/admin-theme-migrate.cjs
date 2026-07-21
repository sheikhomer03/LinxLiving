/**
 * One-off script to migrate admin pages from dark black styling to light theme classes.
 * Usage: node scripts/admin-theme-migrate.cjs
 */
const fs = require("fs");
const path = require("path");

const roots = [
  path.join(__dirname, "..", "src", "app", "admin"),
  path.join(__dirname, "..", "src", "components", "admin"),
];

const replacements = [
  [
    "bg-[#1a1a1a] hover:bg-black text-primary",
    "admin-btn-primary rounded-lg",
  ],
  [
    "bg-[#1a1a1a] text-primary font-black",
    "admin-table-head font-semibold",
  ],
  ["bg-[#1a1a1a] text-primary", "admin-btn-primary rounded-lg"],
  ["bg-[#1a1a1a]", "admin-table-head"],
  [
    "bg-[#333] text-white py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-black",
    "admin-btn-primary rounded-lg py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:opacity-90",
  ],
  [
    "bg-[#333] text-white py-4 text-[10px] uppercase tracking-[0.3em] font-bold",
    "admin-btn-primary rounded-lg py-4 text-[10px] uppercase tracking-[0.3em] font-bold",
  ],
  ["bg-[#333] text-white", "admin-btn-primary rounded-lg"],
  ["bg-[#333]", "admin-btn-primary rounded-lg"],
  ["hover:bg-black", "hover:opacity-90"],
  ["hover:bg-[#333]", "hover:bg-stone-100"],
  ["border-[#333]/5", "border-stone-200/80"],
  ["border-[#333]/10", "border-stone-200"],
  ["border-[#333]/15", "border-stone-200"],
  ["border-[#333]/20", "border-stone-200"],
  ["divide-[#333]/10", "divide-stone-200"],
  ["divide-[#333]/5", "divide-stone-100"],
  ["focus:ring-[#333]/10", "focus:ring-stone-200"],
  ["text-[#333]/60", "text-stone-500"],
  ["text-[#333]/55", "text-stone-500"],
  ["text-[#333]/50", "text-stone-500"],
  ["text-[#333]/45", "text-stone-500"],
  ["text-[#333]/40", "text-stone-400"],
  ["text-[#333]/35", "text-stone-400"],
  ["text-[#333]/30", "text-stone-400"],
  ["text-[#333]", "text-stone-800"],
  ["bg-black/60 backdrop-blur-sm", "admin-modal-overlay"],
  ["bg-black/60", "admin-modal-overlay"],
  [
    "shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-stone-200/80 overflow-hidden",
    "admin-panel-elevated overflow-hidden",
  ],
  [
    "bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-stone-200/80 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12",
    "admin-search px-6 py-3 flex items-center gap-4 lg:gap-6 mb-5 lg:mb-12",
  ],
  [
    "bg-white input-standard px-6 py-3 flex items-center gap-4 lg:gap-6 shadow-sm border border-stone-200 group transition-all duration-700 hover:shadow-md mb-5 lg:mb-12",
    "admin-search px-6 py-3 flex items-center gap-4 lg:gap-6 mb-5 lg:mb-12",
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
    let content = fs.readFileSync(file, "utf8");
    const original = content;
    for (const [from, to] of replacements) {
      content = content.split(from).join(to);
    }
    if (content !== original) {
      fs.writeFileSync(file, content);
      changed++;
      console.log("Updated:", path.relative(process.cwd(), file));
    }
  }
}

console.log(`Done. ${changed} file(s) updated.`);
