const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const xhr = [];
  pg.on("request", r => {
    const t = r.resourceType();
    if (t === "xhr" || t === "fetch") xhr.push(r.method() + " " + r.url().slice(0, 240));
  });
  await pg.goto("https://www.tilemountain.co.uk/porcelain-tiles", { waitUntil: "networkidle", timeout: 90000 });
  const before = await pg.locator('a[href^="/"]').count();
  for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, 25000); await pg.waitForTimeout(2500); }
  await pg.waitForTimeout(3000);
  const after = await pg.locator('a[href^="/"]').count();
  console.log("anchors before scroll:", before, " after:", after);
  console.log("current url:", pg.url());
  console.log("=== xhr/fetch ===");
  [...new Set(xhr)].slice(0, 25).forEach(c => console.log(c));
  // any pagination control?
  const pager = await pg.locator('a[href*="page"], button:has-text("Load"), button:has-text("More")').allTextContents();
  console.log("pager controls:", JSON.stringify(pager.slice(0, 10)));
  await b.close();
})();
