require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
const norm=s=>String(s||'').trim().toLowerCase();
const optAt=(v,p)=>String((p===1?v.option1:p===2?v.option2:v.option3)||'').trim();
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});const col=db.collection('products');
const docs=await col.find({brand:b._id,'colorOptions.0':{$exists:true}},{projection:{name:1,shopifyOptions:1,colorOptions:1,variants:1}}).toArray();
let dup=0,resolvable=0,unresolvable=0,noPicker=0;
for(const d of docs){
  const colours=new Set((d.colorOptions||[]).map(x=>norm(x.name)));
  // any remaining axis still duplicating the swatches?
  if((d.shopifyOptions||[]).some(o=>{const v=(o.values||[]).map(norm);return v.length===colours.size&&v.every(x=>colours.has(x));})) dup++;
  if(!(d.shopifyOptions||[]).length) noPicker++;
  // can every colour still resolve to a distinct variant?
  let pos=0;
  for(const p of [1,2,3]) if((d.variants||[]).some(v=>colours.has(norm(optAt(v,p))))){pos=p;break;}
  const hit=(d.colorOptions||[]).every(co=>(d.variants||[]).some(v=>norm(optAt(v,pos))===norm(co.name)));
  if(pos&&hit) resolvable++; else unresolvable++;
}
console.log('promoted products:',docs.length);
console.log('  still showing the axis twice   :',dup);
console.log('  no picker left (colour only)   :',noPicker);
console.log('  every colour resolves a variant:',resolvable,'| cannot resolve:',unresolvable);
// nothing outside toasty touched
const others=await col.countDocuments({brand:{$ne:b._id},'colorOptions.0':{$exists:true}});
console.log('  other brands with colorOptions (untouched):',others);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
