import { chromium } from "/Users/niazig/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/category?department=tiles&page=2", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/tiles_page2_badges.png" });
await browser.close();
