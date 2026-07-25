/**
 * Third-pass: remaining table cell / title density.
 */
const fs = require("fs");
const path = require("path");

const roots = [
  path.join(__dirname, "..", "src", "app", "admin"),
  path.join(__dirname, "..", "src", "components", "admin"),
];

const replacements = [
  ["px-4 py-6 lg:py-8", "px-4 py-3"],
  ["px-4 py-6", "px-4 py-3"],
  ["py-3 lg:py-6", "py-3"],
  ["space-y-12 pb-8", "admin-page"],
  [
    "text-3xl sm:text-4xl lg:text-5xl font-serif tracking-tight text-primary font-bold",
    "admin-page-title font-serif text-primary",
  ],
  [
    "text-3xl lg:text-4xl font-serif font-bold",
    "text-xl font-serif font-bold",
  ],
  [
    "text-2xl lg:text-3xl font-serif text-primary",
    "text-lg font-serif text-primary",
  ],
  [
    'className="relative z-10 flex items-center gap-2"',
    'className="flex items-center gap-2"',
  ],
  ["\n          <div className=\"hidden\" />", ""],
  [
    "flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-4 text-[9px] sm:text-[10px]",
    "flex items-center gap-2 px-3 py-2 text-[9px] sm:text-[10px]",
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
    if (content !== original) {
      fs.writeFileSync(file, content);
      changed++;
      console.log("Updated:", path.relative(process.cwd(), file));
    }
  }
}

console.log(`Done. ${changed} file(s) updated.`);
