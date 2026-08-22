import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const poll = async (url, label) => {
  await page.goto(`http://localhost:3000${url}`, { waitUntil: "networkidle", timeout: 300000 });
  let n = 0;
  for (let t = 0; t < 20; t++) {
    n = await page.$$eval('a[href^="/products/"]', (a) => new Set(a.map(x => x.getAttribute("href"))).size);
    if (n > 0) break;
    await page.waitForTimeout(500);
  }
  console.log(`${label.padEnd(26)} ${String(n).padStart(3)} cards  ${n === 0 ? "<-- EMPTY" : "ok"}`);
};
for (const [l, q] of [
  ["Showers", "category=shower"], ["Shower trays", "subcategory=shower-trays"],
  ["Wetroom screens", "subcategory=wetroom-shower-screens"], ["Shower columns", "subcategory=shower-columns"],
  ["Bathroom taps", "subcategory=bathroom-taps"], ["Kitchen taps", "category=kitchen-taps"],
  ["Bathroom furniture", "category=bathroom-furniture"], ["Compact furniture", "subcategory=compact-furniture"],
  ["Sanitaryware", "category=sanitaryware"], ["Basins", "category=basins"],
  ["Baths", "category=bathtub"], ["Shop everything", ""],
]) await poll(`/category?department=bathrooms&${q}`, l);
await browser.close();
