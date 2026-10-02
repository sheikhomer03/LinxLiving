require('dotenv').config({ path: '.env.local' });
const dns = require('dns');
dns.setServers((process.env.MONGODB_DNS_SERVERS||'8.8.8.8').split(','));
const { MongoClient } = require('mongodb');
const MB = b => +(b/1048576).toFixed(2);
async function audit(label, uri) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
  await c.connect();
  const out = { label, dbs: [] };
  const { databases } = await c.db('admin').admin().listDatabases();
  for (const d of databases) {
    if (['admin','local','config'].includes(d.name)) continue;
    const db = c.db(d.name);
    const st = await db.stats();
    const dbo = { name: d.name, sizeOnDiskMB: MB(d.sizeOnDisk), dataMB: MB(st.dataSize), storageMB: MB(st.storageSize), indexMB: MB(st.indexSize), colls: [] };
    for (const ci of await db.listCollections({}, { nameOnly: false }).toArray()) {
      if (ci.type === 'view') continue;
      try {
        const [s] = await db.collection(ci.name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
        const ss = s.storageStats;
        let usage = [];
        try { usage = await db.collection(ci.name).aggregate([{ $indexStats: {} }]).toArray(); } catch {}
        dbo.colls.push({ name: ci.name, count: ss.count, dataMB: MB(ss.size), storageMB: MB(ss.storageSize), freeMB: MB(ss.freeStorageSize||0), avgObjKB: +((ss.avgObjSize||0)/1024).toFixed(1), indexMB: MB(ss.totalIndexSize),
          indexes: Object.entries(ss.indexSizes||{}).map(([n, sz]) => { const u = usage.find(x=>x.name===n); return { n, MB: MB(sz), ops: u?.accesses?.ops, since: u?.accesses?.since, key: u?.key }; }) });
      } catch (e) { dbo.colls.push({ name: ci.name, err: e.message }); }
    }
    dbo.colls.sort((a,b)=>(b.storageMB+b.indexMB)-(a.storageMB+a.indexMB));
    out.dbs.push(dbo);
  }
  await c.close();
  return out;
}
(async () => {
  const res = [await audit('primary', process.env.MONGODB_URI), await audit('secondary', process.env.MONGODB_URL2)];
  require('fs').writeFileSync(process.argv[2], JSON.stringify(res, null, 1));
  for (const r of res) for (const d of r.dbs) {
    console.log(`\n=== ${r.label} / ${d.name}  disk=${d.sizeOnDiskMB}MB data=${d.dataMB} storage=${d.storageMB} index=${d.indexMB}`);
    for (const c of d.colls) console.log(`${c.name.padEnd(36)} n=${String(c.count).padStart(7)} data=${c.dataMB} stor=${c.storageMB} free=${c.freeMB} idx=${c.indexMB} avg=${c.avgObjKB}KB idxCount=${c.indexes?.length}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
