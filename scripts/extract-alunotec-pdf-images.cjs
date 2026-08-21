/**
 * Extract embedded JPEGs from the AlunoTec catalogues and price lists.
 *
 * Same byte-walking approach as scripts/extract-oscar-catalog-images.cjs: cut
 * from each JPEG SOI to its matching EOI so one image comes out whole. No PDF
 * library needed, and nothing in the repo ships one.
 *
 *   node scripts/extract-alunotec-pdf-images.cjs
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "public", "AlunoTec-Cassette-Awning");
const OUT = path.join(__dirname, "..", "public", "alunotec", "pages");
fs.mkdirSync(OUT, { recursive: true });

/** Below this a "JPEG" is a table icon or a coating swatch, not product art. */
const MIN_BYTES = 5000;

function extract(file, prefix) {
  const buf = fs.readFileSync(file);
  const found = [];
  let n = 0;
  let i = 0;
  while (i < buf.length - 2) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      let j = i + 2;
      let ok = false;
      while (j < buf.length - 1) {
        if (buf[j] !== 0xff) {
          j++;
          continue;
        }
        const marker = buf[j + 1];
        if (marker === 0xd9) {
          ok = true;
          j += 2;
          break;
        }
        if (marker === 0xda) {
          // Start of scan — the entropy-coded data runs to EOI.
          j += 2;
          while (j < buf.length - 1) {
            if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
              ok = true;
              j += 2;
              break;
            }
            j++;
          }
          break;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          j += 2;
          continue;
        }
        j += 2 + buf.readUInt16BE(j + 2);
      }
      if (ok && j - i > MIN_BYTES) {
        n++;
        const name = `${prefix}-${String(n).padStart(2, "0")}.jpg`;
        fs.writeFileSync(path.join(OUT, name), buf.subarray(i, j));
        found.push({ name, kb: Math.round((j - i) / 1024) });
        i = j;
        continue;
      }
    }
    i++;
  }
  return found;
}

const SOURCES = [
  ["AlunoTec Palora P6 Catalog.pdf", "p6-catalog"],
  ["AlunoTec Cassette Awning Catalog.pdf", "awning-catalog"],
  ["260731 Motorized Palora P6 Price List - AlunoTec Connie.pdf", "p6-motorized"],
  ["260731 Manual Palora P6 Price List - AlunoTec Connie.pdf", "p6-manual"],
  ["260731 Motorized Palora P4 Price List - AlunoTec Connie.pdf", "p4-motorized"],
  ["260731 Manual Palora P4 Price List - AlunoTec Connie.pdf", "p4-manual"],
  ["Palora P6 Warranty.pdf", "warranty"],
];

for (const [file, prefix] of SOURCES) {
  const full = path.join(SRC, file);
  if (!fs.existsSync(full)) {
    console.log(`MISSING  ${file}`);
    continue;
  }
  const found = extract(full, prefix);
  console.log(`${file}  →  ${found.length} image(s)`);
  for (const f of found) console.log(`   ${f.name}  ${f.kb}KB`);
}
