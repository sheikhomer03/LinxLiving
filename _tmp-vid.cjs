require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const cur=db.collection('products').find({brand:b._id},{projection:{shopifyVariantId:1,variants:1}});
let v=0,withId=0,sameAsProduct=0,distinct=0;
for await(const p of cur){
  const ids=new Set();
  for(const r of p.variants||[]){v++;
    const id=String(r.shopifyVariantId||'');
    if(id){withId++;ids.add(id); if(id===String(p.shopifyVariantId||'')) sameAsProduct++;}}
  distinct+=ids.size;
}
console.log('variants total:',v,'| with a shopifyVariantId:',withId,'| equal to the PRODUCT-level id:',sameAsProduct,'| distinct ids:',distinct);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
