const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
const BASE = "http://localhost:3455";
const PAGES = [
  ["/", "homepage"],
  ["/category/tiles", "tiles"],
  ["/category/showers", "showers (Drench categories)"],
  ["/category/taps", "taps"],
  ["/new-arrivals", "new arrivals"],
  ["/search?q=shower", "search: shower"],
];
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  for (const [path, label] of PAGES) {
    try {
      await pg.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
      await pg.waitForTimeout(3500);
      const n = await pg.locator('a[href^="/products/"]').count();
      const imgs = await pg.locator('img[src*="cdn.shopify.com"], img[src*="shopify"]').count();
      console.log(label.padEnd(30) + " cards=" + String(n).padStart(4) + "  shopifyImgs=" + imgs);
    } catch (e) {
      console.log(label.padEnd(30) + " ERROR " + e.message.split("\n")[0]);
    }
  }
  await b.close();
})();
