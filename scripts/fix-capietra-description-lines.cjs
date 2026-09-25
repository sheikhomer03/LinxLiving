require('dotenv').config({ path: '.env.local' });
const { chromium } = require('playwright');
const { MongoClient, ObjectId } = require('mongodb');

const ORIGIN = 'https://capietra.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function htmlToLines(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|li|div|h[1-6])>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  s = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return s.trim();
}

(async () => {
  if (process.env.MONGODB_DNS_SERVERS) {
    require('dns').setServers(process.env.MONGODB_DNS_SERVERS.split(','));
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const products = db.collection('products');
  const bid = new ObjectId('6ab3ab4fb9eb9cb4198daffd');

  // Group doc _ids by handle (the size-exploded docs of one source product
  // all share the same handle up to the '?variant=' query, and share the
  // same bodyHtml/description).
  const docs = await products.find({ brand: bid }).project({ sourceUrl: 1, description: 1 }).toArray();
  const byHandle = new Map();
  for (const d of docs) {
    const handle = String(d.sourceUrl || '').split('/products/')[1]?.split('?')[0];
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push(d);
  }
  console.log('distinct handles:', byHandle.size, 'total docs:', docs.length);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const seedPage = await context.newPage();
  await seedPage.goto(`${ORIGIN}/products.json?limit=1`, { waitUntil: 'load', timeout: 45000 });
  await seedPage.close();

  const beforeCount = await products.countDocuments({ brand: bid });
  let done = 0, updated = 0, errors = 0;
  for (const [handle, group] of byHandle) {
    try {
      const resp = await context.request.get(`${ORIGIN}/products/${handle}.json`, { timeout: 20000 });
      if (resp.status() !== 200) { errors++; continue; }
      const j = await resp.json();
      const bodyHtml = j?.product?.body_html;
      if (!bodyHtml) { errors++; continue; }
      const fixed = htmlToLines(bodyHtml);
      for (const d of group) {
        if (fixed && fixed !== d.description) {
          await products.updateOne({ _id: d._id }, { $set: { description: fixed } });
          updated++;
        }
      }
    } catch (e) {
      errors++;
    } finally {
      done++;
      if (done % 100 === 0) console.log(`${done}/${byHandle.size} handles  updated ${updated} docs  errors ${errors}`);
    }
  }
  const afterCount = await products.countDocuments({ brand: bid });
  console.log('FINAL:', done, 'handles processed,', updated, 'docs updated,', errors, 'errors');
  console.log('count unchanged:', beforeCount === afterCount, beforeCount, afterCount);
  await browser.close();
  await client.close();
})().catch(e => { console.error(e); process.exit(1); });
