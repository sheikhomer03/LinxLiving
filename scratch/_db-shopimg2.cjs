require('dotenv').config({ path: '.env.local', quiet: true });
require('dns').setServers((process.env.MONGODB_DNS_SERVERS||'8.8.8.8').split(','));
const { MongoClient } = require('mongodb');
const MB = b => +(b/1048576).toFixed(2);
async function run(label, uri) {
  const c = new MongoClient(uri); await c.connect();
  const col = c.db('test').collection('products');
  const [r] = await col.aggregate([{ $match: { 'shopifyImages.0': { $exists: true } } }, { $unwind: '$shopifyImages' },
    { $project: { s: '$shopifyImages.sourceUrl', u: '$shopifyImages.shopifyUrl' } },
    { $group: { _id: null, n: { $sum: 1 },
      same: { $sum: { $cond: [{ $eq: ['$s','$u'] }, 1, 0] } },
      sameBytes: { $sum: { $cond: [{ $eq: ['$s','$u'] }, { $strLenBytes: { $ifNull: ['$s',''] } }, 0] } },
      srcBytes: { $sum: { $strLenBytes: { $ifNull: ['$s',''] } } },
      cloud: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$s',''] }, regex: 'cloudinary' } }, 1, 0] } } } }]).toArray();
  const [d] = await col.aggregate([{ $match: { 'shopifyImages.1': { $exists: true } } },
    { $project: { n: { $size: '$shopifyImages' }, u: { $size: { $setUnion: ['$shopifyImages.shopifyUrl', []] } } } },
    { $group: { _id: null, imgs: { $sum: '$n' }, uniq: { $sum: '$u' } } }]).toArray();
  const [x] = await col.aggregate([{ $match: { 'shopifyImages.0': { $exists: true }, 'images.0': { $exists: true } } }, { $count: 'n' }]).toArray();
  const m = await col.findOne({ name: label==='primary' ? 'Matrix®' : /^Riace Linea Flat/ }, { projection: { 'shopifyImages.shopifyUrl': 1, 'variants': { $slice: 0 } } });
  const mu = m?.shopifyImages?.map(i=>i.shopifyUrl) || [];
  console.log(`\n=== ${label}: ${r.n} entries | sourceUrl===shopifyUrl: ${r.same} (${MB(r.sameBytes)} MB redundant) | sourceUrl total ${MB(r.srcBytes)} MB | cloudinary sources: ${r.cloud}`);
  console.log('   within-product: entries', d.imgs, 'distinct shopifyUrl', d.uniq, '=> repeated', d.imgs-d.uniq);
  console.log('   products that also have legacy `images`:', x?.n);
  console.log('   biggest product images:', mu.length, 'distinct', new Set(mu).size);
  await c.close();
}
(async () => { await run('primary', process.env.MONGODB_URI); await run('secondary', process.env.MONGODB_URL2); })();
