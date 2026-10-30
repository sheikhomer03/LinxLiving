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

  const testUrl = ORIGIN + "/kitchen-tiles-c48/barnaby-range-c5403/elba-grey-25cm-x-40cm-wall-tile-p13253";
  const resPdp = await fetch(testUrl, { headers: { "user-agent": UA, cookie } });
  const html = await resPdp.text();

  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (m) {
    console.log("RAW JSON-LD:\n", m[1]);
  }

  const availIdx = html.indexOf("Availability");
  if (availIdx !== -1) {
    console.log("HTML AROUND AVAILABILITY:\n", html.substring(availIdx - 100, availIdx + 400));
  }
}

probe().catch(console.error);
