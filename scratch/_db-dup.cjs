require('dotenv').config({ path: '.env.local', quiet: true });
require('dns').setServers((process.env.MONGODB_DNS_SERVERS||'8.8.8.8').split(','));
const { MongoClient, BSON } = require('mongodb');
const crypto = require('crypto');
const MB = b => +(b/1048576).toFixed(2);
async function run(label, uri) {
  const c = new MongoClient(uri); await c.connect();
  const col = c.db('test').collection('products');
  const stats = {}; // field -> {total, uniq, map}
  const sub = {}; // variants/shopifyImages subfield bytes
  const bump = (o,k,b)=>{o[k]=(o[k]||0)+b};
  let n=0;
  for await (const d of col.find({}, { raw: false })) {
    n++;
    for (const [k,v] of Object.entries(d)) {
      if (k==='_id') continue;
      const buf = BSON.serialize({ v }); const b = buf.length;
      const s = stats[k] ||= { total:0, uniq:0, set:new Set(), docs:0 };
      s.total+=b; s.docs++;
      const h = crypto.createHash('sha1').update(buf).digest('base64');
      if (!s.set.has(h)) { s.set.add(h); s.uniq+=b; }
    }
    for (const f of ['variants','shopifyImages','images','productSections','shades','bases','wallFittings']) {
      if (!Array.isArray(d[f])) continue;
      for (const el of d[f]) if (el && typeof el==='object') for (const [k,v] of Object.entries(el)) bump(sub[f] ||= {}, k, BSON.serialize({v}).length);
    }
  }
  console.log(`\n=== ${label} (${n} docs) field / total MB / unique MB / dup MB / distinct`);
  Object.entries(stats).sort((a,b)=>b[1].total-a[1].total).slice(0,30).forEach(([k,s])=>console.log(k.padEnd(22), MB(s.total), MB(s.uniq), MB(s.total-s.uniq), s.set.size, '/', s.docs));
  for (const [f,o] of Object.entries(sub)) { console.log(`-- ${f} subfields`); Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,14).forEach(([k,b])=>console.log('   ',k.padEnd(26), MB(b))); }
  await c.close();
}
(async () => { await run('primary', process.env.MONGODB_URI); await run('secondary', process.env.MONGODB_URL2); })();
