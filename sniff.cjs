const { chromium } = require("D:/OMER/linxLiving/LinxLiving/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const calls = [];
  pg.on("request", r => {
    const u = r.url();
    if (/\/api\/|graphql|m2\.tilemountain/.test(u) && !/\.(png|jpg|jpeg|webp|svg|css|woff2?)/i.test(u)) {
      calls.push(r.method() + " " + u.slice(0, 220));
    }
  });
  await pg.goto("https://www.tilemountain.co.uk/porcelain-tiles", { waitUntil: "domcontentloaded", timeout: 90000 });
  await pg.waitForTimeout(6000);
  // trigger paging
  for (let i = 0; i < 3; i++) {
    await pg.mouse.wheel(0, 20000);
    await pg.waitForTimeout(3000);
  }
  console.log("=== API calls ===");
  [...new Set(calls)].forEach(c => console.log(c));
  await b.close();
})();
