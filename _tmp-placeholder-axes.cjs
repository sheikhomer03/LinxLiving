require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const docs=await db.collection('products').find({brand:b._id,'shopifyOptions.name':/^select an option$/i},{projection:{name:1,shopifyOptions:1,variantGroups:1}}).limit(6).toArray();
console.log('sample of the "Select an option" axes:\n');
for(const d of docs){
  const ax=(d.shopifyOptions||[]).find(o=>/^select an option$/i.test(String(o.name||'')));
  console.log('*',d.name.slice(0,62));
  console.log('   captured variantGroups:',JSON.stringify(d.variantGroups));
  console.log('   values:',JSON.stringify((ax.values||[]).slice(0,6)));
}
// Do those values look like colours/finishes?
const COLOURISH=/(white|black|chrome|brass|bronze|nickel|anthracite|grey|gray|copper|gold|silver|matt|gloss|brushed|polished|satin|pewter|graphite|sand|cream)/i;
const all=await db.collection('products').find({brand:b._id,'shopifyOptions.name':/^select an option$/i},{projection:{shopifyOptions:1}}).toArray();
let colour=0,other=0;
for(const d of all){
  const ax=(d.shopifyOptions||[]).find(o=>/^select an option$/i.test(String(o.name||'')));
  const vals=ax.values||[];
  if(vals.length&&vals.every(v=>COLOURISH.test(String(v)))) colour++; else other++;
}
console.log('\nof',all.length,'placeholder axes: every value looks like a finish/colour ->',colour,'| mixed/other ->',other);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
