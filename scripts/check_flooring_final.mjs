import { chromium } from "/Users/niazig/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const browser = await chromium.launch();

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/category?department=flooring&page=2", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/flooring_page2_badges.png" });

// Click through sample on a plain flooring product
const page2 = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page2.goto("http://localhost:3000/products/6a7ac9b70e7fd4bdd6e411da", { waitUntil: "networkidle" });
const link = page2.getByRole("link", { name: /request a free sample/i });
await link.scrollIntoViewIfNeeded();
await link.click({ force: true });
await page2.waitForLoadState("networkidle");
console.log("URL:", page2.url());
await page2.screenshot({ path: "/tmp/flooring_sample_contact.png" });

await browser.close();
