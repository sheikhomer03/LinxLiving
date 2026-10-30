const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ORIGIN = "https://www.al-murad.co.uk";

async function probe() {
  const res1 = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
  const html1 = await res1.text();
  const code = (/accessCode = "([^"]+)"/.exec(html1) || [])[1];
  let cookie = "";
  if (code) {
    const setCookie = res1.headers.get("set-cookie") || "";
    const cookieBits = setCookie.split(/,(?=[^;]+=[^;]+;)/).map(c => c.split(";")[0].trim()).filter(c => c.includes("="));
    const res2 = await fetch(ORIGIN + "/?ayh_access=" + code, { headers: { "user-agent": UA, cookie: cookieBits.join("; ") } });
    const setCookie2 = res2.headers.get("set-cookie") || "";
    const moreBits = setCookie2.split(/,(?=[^;]+=[^;]+;)/).map(c => c.split(";")[0].trim()).filter(c => c.includes("="));
    const merged = new Map();
    for (const c of [...cookieBits, ...moreBits]) {
      const [k] = c.split("=");
      merged.set(k, c);
    }
    cookie = [...merged.values()].join("; ");
  }

  // 1. Check a category page HTML to see what product cards contain
  const catUrl = ORIGIN + "/kitchen-tiles-c48/barnaby-range-c5403";
  console.log("Checking category:", catUrl);
  const resCat = await fetch(catUrl, { headers: { "user-agent": UA, cookie } });
  const catHtml = await resCat.text();
  console.log("Cat status:", resCat.status);
  
  // Look for product card snippets
  const cardMatch = catHtml.match(/<div[^>]*class="[^"]*product[^"]*"[\s\S]{1,500}?>/i);
  if (cardMatch) console.log("Product card sample:", cardMatch[0]);

  // Check if out of stock is mentioned in category HTML
  const oosMatches = [...catHtml.matchAll(/out\s*of\s*stock|sold\s*out/gi)];
  console.log("Out of stock occurrences on category page:", oosMatches.length);

  // Check if there is an Ajax / search endpoint or sitemap
  const sitemapRes = await fetch(ORIGIN + "/robots.txt", { headers: { "user-agent": UA, cookie } });
  console.log("Robots.txt status:", sitemapRes.status);
  const robots = await sitemapRes.text();
  console.log("Robots.txt snippet:\n", robots.slice(0, 300));
}

probe().catch(console.error);
