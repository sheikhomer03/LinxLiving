const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
const BASE = "http://localhost:3455";
const URLS = [
  "/search?q=Harbour%20G9",
  "/search?q=shower",
  "/search?q=Drench",
  "/category/tiles?brand=drench",
];
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  for (const u of URLS) {
    try {
      await pg.goto(BASE + u, { waitUntil: "domcontentloaded", timeout: 90000 });
      await pg.waitForTimeout(3500);
      const hrefs = await pg.locator('a[href^="/products/"]').evaluateAll(a => a.map(x => x.getAttribute("href")));
      const ids = [...new Set(hrefs.map(h => h.split("/products/")[1].split(/[?#]/)[0]))];
      console.log(u.padEnd(34) + " cards=" + String(ids.length).padStart(3));
      if (ids.length) console.log("      first ids: " + ids.slice(0, 3).join(", "));
    } catch (e) { console.log(u.padEnd(34) + " ERROR " + e.message.split("\n")[0]); }
  }
  await b.close();
})();
