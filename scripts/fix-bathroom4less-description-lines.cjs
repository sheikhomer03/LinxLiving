require('dotenv').config({ path: '.env.local' });
const { MongoClient, ObjectId } = require('mongodb');

const ORIGIN = 'https://www.bathroom4less.co.uk';
const CONCURRENCY = 2;
const DELAY_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithBackoff(url, opts, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429) return res;
    const wait = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s, 40s, 80s
    console.log(`  429 on ${url} — backing off ${wait / 1000}s (attempt ${attempt + 1}/${tries})`);
    await sleep(wait);
  }
  return fetch(url, opts); // final attempt, let caller see whatever it is
}

function htmlToLines(html) {
  if (!html) return '';
  let s = String(html);
  // Turn block-level boundaries into newlines BEFORE stripping tags.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|li|div|h[1-6])>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, ''); // strip remaining tags
  s = s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  // Collapse intra-line whitespace, but keep the newlines that mark real breaks.
  s = s.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return s.trim();
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

(async () => {
  const dns = require('dns');
  if (process.env.MONGODB_DNS_SERVERS) dns.setServers(process.env.MONGODB_DNS_SERVERS.split(','));
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const products = db.collection('products');
  const bid = new ObjectId('6ab2789dddda9aaf6d387af0');

  // Only the ones not already fixed (no newline yet) — resumable, avoids
  // re-hitting the site for the ~436 already confirmed multi-line.
  const docs = await products.find({ brand: bid, description: { $not: { $regex: '\n' } } })
    .project({ sourceUrl: 1, sourceHandle: 1, description: 1 }).toArray();
  console.log('total to process:', docs.length);

  const beforeCount = await products.countDocuments({ brand: bid });
  let done = 0, updated = 0, errors = 0;
  await pool(docs, CONCURRENCY, async (doc) => {
    try {
      const handle = doc.sourceHandle || (doc.sourceUrl || '').split('/products/')[1];
      if (!handle) { errors++; return; }
      const res = await fetchWithBackoff(`${ORIGIN}/products/${handle}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { errors++; console.log('  non-ok', res.status, handle); return; }
      const j = await res.json();
      const bodyHtml = j?.product?.body_html;
      if (!bodyHtml) { errors++; return; }
      const fixed = htmlToLines(bodyHtml);
      if (fixed && fixed !== doc.description) {
        await products.updateOne({ _id: doc._id }, { $set: { description: fixed } });
        updated++;
      }
      await sleep(DELAY_MS);
    } catch (e) {
      errors++;
    } finally {
      done++;
      if (done % 250 === 0) console.log(`${done}/${docs.length}  updated ${updated}  errors ${errors}`);
    }
  });
  const afterCount = await products.countDocuments({ brand: bid });
  console.log('FINAL:', done, 'processed,', updated, 'updated,', errors, 'errors');
  console.log('count unchanged:', beforeCount === afterCount, beforeCount, afterCount);
  await client.close();
})().catch(e => { console.error(e); process.exit(1); });
