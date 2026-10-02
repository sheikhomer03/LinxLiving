require('dotenv').config({ path: '.env.local', quiet: true });
require('dns').setServers((process.env.MONGODB_DNS_SERVERS||'8.8.8.8').split(','));
const { MongoClient } = require('mongodb');
const MB = b => +(b/1048576).toFixed(2);
async function run(label, uri) {
  const c = new MongoClient(uri); await c.connect();
  const col = c.db('test').collection('products');
  const [agg] = await col.aggregate([{ $match: { 'shopifyImages.0': { $exists: true } } },
    { $project: { n: { $size: '$shopifyImages' }, b: { $bsonSize: { v: '$shopifyImages' } } } },
    { $group: { _id: null, docs: { $sum: 1 }, imgs: { $sum: '$n' }, maxN: { $max: '$n' }, bytes: { $sum: '$b' } } }]).toArray();
  console.log(`\n=== ${label}`, agg && { docs: agg.docs, images: agg.imgs, maxPerProduct: agg.maxN, MB: MB(agg.bytes), avgBytesPerImage: Math.round(agg.bytes/agg.imgs) });
  // per-subfield bytes (on a 2000-doc sample)
  const sub = await col.aggregate([{ $match: { 'shopifyImages.0': { $exists: true } } }, { $sample: { size: 2000 } },
    { $unwind: '$shopifyImages' }, { $project: { kv: { $objectToArray: '$shopifyImages' } } }, { $unwind: '$kv' },
    { $group: { _id: '$kv.k', bytes: { $sum: { $bsonSize: { v: '$kv.v' } } }, n: { $sum: 1 } } }, { $sort: { bytes: -1 } }]).toArray();
  const tot = sub.reduce((s,x)=>s+x.bytes,0);
  console.log('subfield share (sample):'); sub.forEach(s=>console.log('  ', s._id.padEnd(20), (100*s.bytes/tot).toFixed(1)+'%', 'avg', Math.round(s.bytes/s.n), 'B'));
  // duplicate images within a product (same url repeated)
  const [dup] = await col.aggregate([{ $match: { 'shopifyImages.1': { $exists: true } } },
    { $project: { n: { $size: '$shopifyImages' }, u: { $size: { $setUnion: [{ $map: { input: '$shopifyImages', in: { $ifNull: ['$$this.url', '$$this.src'] } } }, []] } } } },
    { $group: { _id: null, imgs: { $sum: '$n' }, uniq: { $sum: '$u' } } }]).toArray();
  console.log('within-product duplicates:', dup);
  const big = await col.find({ 'shopifyImages.0': { $exists: true } }).project({ name: 1, n: { $size: '$shopifyImages' } }).sort({}).limit(0).toArray().catch(()=>[]);
  const top = big.sort((a,b)=>b.n-a.n).slice(0,3); console.log('most images:', top.map(t=>`${t.n} ${t.name}`));
  const ex = await col.findOne({ 'shopifyImages.0': { $exists: true } }, { projection: { shopifyImages: { $slice: 1 } } });
  console.log('example element:', JSON.stringify(ex.shopifyImages[0], null, 1));
  await c.close();
}
(async () => { await run('primary', process.env.MONGODB_URI); await run('secondary', process.env.MONGODB_URL2); })();
