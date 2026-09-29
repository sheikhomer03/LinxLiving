import { chromium } from "/Users/niazig/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto("http://localhost:3000/products/6a7ac9b70e7fd4bdd6e411da", { waitUntil: "networkidle" });
const href = await page.getByRole("link", { name: /request a free sample/i }).getAttribute("href");
console.log("HREF:", href);
await browser.close();
