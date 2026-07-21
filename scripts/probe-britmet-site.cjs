const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const OUT = path.join(__dirname, "..", "tmp", "britmet-dropbox");
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { slug: "liteslate", url: "https://www.britmet.co.uk/liteslate.asp", name: "Liteslate" },
  { slug: "shingle", url: "https://www.britmet.co.uk/shingle.asp", name: "Shingle" },
  { slug: "slate2000", url: "https://www.britmet.co.uk/slate2000.asp", name: "Slate 2000" },
  { slug: "ultratile", url: "https://www.britmet.co.uk/ultratile.asp", name: "Ultratile" },
  { slug: "villatile", url: "https://www.britmet.co.uk/villatile.asp", name: "Villatile" },
  { slug: "profile49", url: "https://www.britmet.co.uk/profile49.asp", name: "Profile 49" },
  { slug: "plaintile", url: "https://www.britmet.co.uk/plaintile.asp", name: "Plaintile" },
  { slug: "pantile2000", url: "https://www.britmet.co.uk/pantile2000.asp", name: "Pantile 2000" },
  { slug: "ecopan", url: "https://www.britmet.co.uk/ecopan.asp", name: "Ecopan" },
  { slug: "ecopanplus", url: "https://www.britmet.co.uk/ecopanplus.asp", name: "Ecopan Plus" },
  { slug: "parcpan", url: "https://www.britmet.co.uk/parcpan.asp", name: "Parcpan" },
  { slug: "doorcanopies", url: "https://www.britmet.co.uk/doorcanopies.asp", name: "Door Canopies" },
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 LinxTradeImporter/1.0",
          Accept: "text/html",
        },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`${url} -> ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
  });
}

function extractImages(html) {
  const urls = new Set();
  const re = /(?:src|data-src|href)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (u.startsWith("//")) u = "https:" + u;
    else if (u.startsWith("/")) u = "https://www.britmet.co.uk" + u;
    else if (!u.startsWith("http")) u = "https://www.britmet.co.uk/" + u.replace(/^\.\//, "");
    // skip tiny UI assets
    if (/logo|favicon|icon|sprite|btn|arrow|search|email|facebook|twitter|linkedin|youtube/i.test(u)) {
      continue;
    }
    urls.add(u.split("?")[0]);
  }
  return [...urls];
}

function extractDescription(html) {
  const meta = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (meta) return meta[1].trim();
  const p = html.match(/<p[^>]*>([^<]{80,400})<\/p>/i);
  return p ? p[1].replace(/\s+/g, " ").trim() : "";
}

(async () => {
  const catalog = [];
  for (const page of PAGES) {
    try {
      const html = await fetchText(page.url);
      fs.writeFileSync(path.join(OUT, `${page.slug}.html`), html);
      const images = extractImages(html);
      const description = extractDescription(html);
      catalog.push({
        name: page.name,
        slug: page.slug,
        url: page.url,
        description,
        images,
      });
      console.log(`${page.name}: ${images.length} images`);
      images.slice(0, 8).forEach((u) => console.log("  ", u));
    } catch (err) {
      console.log(`${page.name}: FAIL ${err.message}`);
    }
  }
  fs.writeFileSync(
    path.join(OUT, "britmet-catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  console.log("Wrote britmet-catalog.json");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
