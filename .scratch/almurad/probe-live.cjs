const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ORIGIN = "https://www.al-murad.co.uk";

async function probe() {
  console.log("Probing Al Murad homepage...");
  const res1 = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
  console.log("Homepage status:", res1.status);
  const html1 = await res1.text();
  const code = (/accessCode = "([^"]+)"/.exec(html1) || [])[1];
  console.log("Access code found:", !!code);

  let cookie = "";
  if (code) {
    const setCookie = res1.headers.get("set-cookie") || "";
    const cookieBits = setCookie
      .split(/,(?=[^;]+=[^;]+;)/)
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.includes("="));
    const res2 = await fetch(ORIGIN + "/?ayh_access=" + code, {
      headers: { "user-agent": UA, cookie: cookieBits.join("; ") },
    });
    console.log("Bypass request status:", res2.status);
    const setCookie2 = res2.headers.get("set-cookie") || "";
    const moreBits = setCookie2
      .split(/,(?=[^;]+=[^;]+;)/)
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.includes("="));
    const merged = new Map();
    for (const c of [...cookieBits, ...moreBits]) {
      const [k] = c.split("=");
      merged.set(k, c);
    }
    cookie = [...merged.values()].join("; ");
  }

  // Probe a sample product page
  const testUrl = ORIGIN + "/kitchen-tiles-c48/barnaby-range-c5403/elba-grey-25cm-x-40cm-wall-tile-p13253";
  console.log("Probing sample PDP:", testUrl);
  const resPdp = await fetch(testUrl, {
    headers: { "user-agent": UA, cookie },
  });
  console.log("PDP status:", resPdp.status);
  const pdpHtml = await resPdp.text();

  // Extract JSON-LD
  const ldMatches = [...pdpHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  console.log("Found JSON-LD blocks:", ldMatches.length);
  for (const m of ldMatches) {
    try {
      const data = JSON.parse(m[1]);
      if (data["@type"] === "Product" || data.offers) {
        console.log("PRODUCT JSON-LD:", {
          name: data.name,
          sku: data.sku,
          offers: data.offers
        });
      }
    } catch {}
  }

  // Check if stock text or exact quantity is visible on page
  const stockMatch = pdpHtml.match(/in stock|out of stock|\d+\s*in stock|availability/i);
  console.log("HTML stock match snippet:", stockMatch ? stockMatch[0] : "none");
}

probe().catch(console.error);
