const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const xhr = [];
  pg.on("request", r => {
    const t = r.resourceType();
    if (t === "xhr" || t === "fetch") xhr.push({ m: r.method(), u: r.url(), body: r.postData() });
  });
  await pg.goto("https://www.tilemountain.co.uk/porcelain-tiles", { waitUntil: "networkidle", timeout: 90000 });
  const countProds = async () => (await pg.locator('a[href^="/"]').evaluateAll(a =>
    [...new Set(a.map(x => x.getAttribute("href")).filter(h => h && h.split("/").length === 2))].length));
  console.log("products before:", await countProds());
  const btn = pg.locator('button:has-text("LOAD NEXT")').first();
  await btn.click();
  await pg.waitForTimeout(6000);
  console.log("products after :", await countProds());
  console.log("url after      :", pg.url());
  console.log("=== xhr after click ===");
  xhr.slice(-12).forEach(c => console.log(c.m + " " + c.u.slice(0, 260) + (c.body ? "\n   BODY " + c.body.slice(0, 400) : "")));
  await b.close();
})();
