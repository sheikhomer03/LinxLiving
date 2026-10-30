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

  // Test 1: Search by SKU
  const searchUrl = ORIGIN + "/search/" + encodeURIComponent("10022028");
  const resSearch = await fetch(searchUrl, { headers: { "user-agent": UA, cookie }, redirect: "manual" });
  console.log("Search by SKU status:", resSearch.status, "location:", resSearch.headers.get("location"));

  // Test 2: Can we fetch directly by product id? e.g. /-p14284
  const idUrl = ORIGIN + "/-p14284";
  const resId = await fetch(idUrl, { headers: { "user-agent": UA, cookie }, redirect: "manual" });
  console.log("Fetch /-p14284 status:", resId.status, "location:", resId.headers.get("location"));

  // Test 3: Query parameter search: /search?term=10022028 or /search/products?keyword=
  const termUrl = ORIGIN + "/search?term=10022028";
  const resTerm = await fetch(termUrl, { headers: { "user-agent": UA, cookie }, redirect: "manual" });
  console.log("Fetch /search?term= status:", resTerm.status, "location:", resTerm.headers.get("location"));
}

probe().catch(console.error);
