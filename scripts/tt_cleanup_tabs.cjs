const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('open pages:', pages.length);
  for (const p of pages) {
    const url = p.url();
    if (url === 'about:blank' || url.includes('totaltiles.co.uk')) {
      // keep one totaltiles page open as anchor, close rest below via count check
    }
  }
  // Close all but keep the browser alive; leave one blank/anchor tab
  let kept = false;
  for (const p of pages) {
    if (!kept) { kept = true; continue; }
    try { await p.close(); } catch (e) {}
  }
  console.log('cleanup done, remaining:', ctx.pages().length);
})();
