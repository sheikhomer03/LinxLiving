const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await pg.goto("https://www.tilemountain.co.uk/", { waitUntil: "networkidle", timeout: 90000 });
  await pg.waitForTimeout(2500);
  const tops = await pg.locator('header a, nav a').evaluateAll(as =>
    as.map(a => ({ t: (a.textContent || "").trim().replace(/\s+/g, " "), h: a.getAttribute("href") }))
      .filter(x => x.h && x.h.startsWith("/") && x.t));
  const groups = {};
  // hover each top-level item to reveal its mega menu
  const labels = ["All Tiles","Bathroom","Kitchen","Floor","Wall","Outdoor","Flooring","Vinyl","Laminate","Engineered Wood","Tools & Accessories","New","Sale & Offers"];
  for (const L of labels) {
    try {
      const el = pg.locator(`header >> text="${L}"`).first();
      await el.hover({ timeout: 4000 });
      await pg.waitForTimeout(1200);
      const links = await pg.locator('header a:visible, [class*="mega"] a:visible, [class*="dropdown"] a:visible').evaluateAll(as =>
        as.map(a => ({ t: (a.textContent || "").trim().replace(/\s+/g, " "), h: a.getAttribute("href") }))
          .filter(x => x.h && x.h.startsWith("/") && x.t && x.t.length < 60));
      groups[L] = links;
      console.log(L + ": " + links.length + " visible links");
    } catch (e) { console.log(L + ": " + e.message.split("\n")[0]); }
  }
  fs.writeFileSync("C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad/tm-nav-raw.json", JSON.stringify({ tops, groups }, null, 1));
  await b.close();
})();
