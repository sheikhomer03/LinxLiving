/** Extract embedded JPEGs from the Oscar catalog + price list (no deps). */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "public", "oscar", "pages");
fs.mkdirSync(OUT, { recursive: true });

function extract(file, prefix) {
  const buf = fs.readFileSync(file);
  let n = 0;
  let i = 0;
  const found = [];
  while (i < buf.length - 1) {
    // JPEG SOI
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      // walk JPEG segments to the EOI so we cut exactly one image
      let j = i + 2;
      let ok = false;
      while (j < buf.length - 1) {
        if (buf[j] !== 0xff) { j++; continue; }
        const marker = buf[j + 1];
        if (marker === 0xd9) { ok = true; j += 2; break; }
        if (marker === 0xda) {
          // start of scan — scan for EOI, skipping stuffed bytes
          j += 2;
          while (j < buf.length - 1) {
            if (buf[j] === 0xff && buf[j + 1] === 0xd9) { ok = true; j += 2; break; }
            j++;
          }
          break;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { j += 2; continue; }
        const len = buf.readUInt16BE(j + 2);
        j += 2 + len;
      }
      if (ok && j - i > 5000) {
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

const a = extract(path.join(__dirname, "..", "public", "oscar", "Oscar pergola catalog.(1).pdf"), "catalog");
const b = extract(path.join(__dirname, "..", "public", "oscar", "Standard Size Price List 2026.pdf"), "pricelist");
console.log("catalog images:", a.length);
for (const f of a) console.log(`   ${f.name}  ${f.kb}KB`);
console.log("price list images:", b.length);
for (const f of b) console.log(`   ${f.name}  ${f.kb}KB`);
