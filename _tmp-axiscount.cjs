require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
const NAMED=/^(finish|colour|color|shade|texture)$/i, PH=/^\s*select an option/i;
const COLOURISH=/(white|black|chrome|brass|bronze|nickel|anthracite|grey|gray|copper|gold|silver|matt|gloss|brushed|polished|satin|pewter|graphite|sand|cream|mocha|heban|quartz)/i;
function appearance(opts){for(const o of opts||[]){const n=String(o?.name||'').trim();const v=(o?.values||[]).map(x=>String(x||'').trim()).filter(Boolean);if(v.length<2)continue;if(NAMED.test(n))return o;if(PH.test(n)&&v.every(x=>COLOURISH.test(x)))return o;}return null;}
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const docs=await db.collection('products').find({brand:b._id,'colorOptions.0':{$exists:true}},{projection:{name:1,shopifyOptions:1,colorOptions:1,variants:1}}).toArray();
let single=0,multi=0,sapOk=0,sapTotal=0;const multiEx=[];
for(const d of docs){
  const ax=appearance(d.shopifyOptions);
  const n=(d.shopifyOptions||[]).length;
  if(n<=1) single++; else {multi++; if(multiEx.length<5) multiEx.push(d.name.slice(0,45)+' :: '+(d.shopifyOptions||[]).map(o=>o.name).join(' + '));}
  for(const co of d.colorOptions||[]){sapTotal++;
    if(co.sap&&(d.variants||[]).some(v=>String(v.sku||'').trim()===String(co.sap).trim())) sapOk++;}
}
console.log('promoted products:',docs.length);
console.log('  with ONLY the appearance axis:',single);
console.log('  with additional axes too     :',multi);
multiEx.forEach(x=>console.log('     -',x));
console.log('  colour rows whose sap matches a variant sku:',sapOk,'/',sapTotal);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
