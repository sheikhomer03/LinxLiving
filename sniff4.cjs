const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const hits = [];
  pg.on("request", r => {
    if (/\/m2\//.test(r.url())) hits.push({ u: r.url(), body: r.postData() });
  });
  await pg.goto("https://www.tilemountain.co.uk/zellige-sage-green-gloss-porcelain-tile", { waitUntil: "networkidle", timeout: 90000 });
  await pg.waitForTimeout(4000);
  // open the calculator to see if it loads anything
  try { await pg.locator('text=How many do I need?').first().click({ timeout: 5000 }); await pg.waitForTimeout(2500); } catch (e) {}
  console.log("=== /m2/ endpoints hit ===");
  [...new Set(hits.map(h => h.u))].forEach(u => console.log("  " + u));
  console.log("\n=== first query body (truncated) ===");
  if (hits[0] && hits[0].body) console.log(hits[0].body.slice(0, 1800));
  await b.close();
})();
