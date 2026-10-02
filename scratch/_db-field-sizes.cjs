require('dotenv').config({ path: '.env.local', quiet: true });
require('dns').setServers((process.env.MONGODB_DNS_SERVERS||'8.8.8.8').split(','));
const { MongoClient } = require('mongodb');
const MB = b => +(b/1048576).toFixed(2);
async function run(label, uri) {
  const c = new MongoClient(uri); await c.connect();
  const col = c.db('test').collection('products');
  const top = await col.aggregate([
    { $project: { kv: { $objectToArray: '$$ROOT' } } }, { $unwind: '$kv' },
    { $group: { _id: '$kv.k', bytes: { $sum: { $bsonSize: { v: '$kv.v' } } }, docs: { $sum: 1 } } },
    { $sort: { bytes: -1 } }, { $limit: 40 } ], { allowDiskUse: true }).toArray();
  console.log(`\n=== ${label} products top-level fields`);
  for (const t of top) console.log(`${t._id.padEnd(32)} ${String(MB(t.bytes)).padStart(8)} MB  in ${t.docs} docs`);
  const status = await col.aggregate([{ $group: { _id: { s: '$status', a: '$isActive' }, n: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }, { $sort: { bytes: -1 } }]).toArray();
  console.log('-- by status/isActive'); for (const s of status) console.log(JSON.stringify(s._id), s.n, MB(s.bytes)+'MB');
  const big = await col.aggregate([{ $project: { name: 1, b: { $bsonSize: '$$ROOT' } } }, { $sort: { b: -1 } }, { $limit: 5 }]).toArray();
  console.log('-- biggest docs'); for (const b of big) console.log(MB(b.b)+'MB', b.name);
  await c.close();
}
(async () => { await run('primary', process.env.MONGODB_URI); await run('secondary', process.env.MONGODB_URL2); })();
