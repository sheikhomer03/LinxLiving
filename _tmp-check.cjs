require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const col=db.collection('products');
console.log('products with >=1 shopifyImages.shopifyUrl non-empty:',
  await col.countDocuments({brand:b._id,'shopifyImages.shopifyUrl':{$nin:[null,'']}}));
console.log('products with >=1 shopifyUrl on cdn.shopify.com     :',
  await col.countDocuments({brand:b._id,'shopifyImages.shopifyUrl':/cdn\.shopify\.com/}));
const p=await col.findOne({brand:b._id,'shopifyImages.shopifyUrl':{$nin:[null,'']}},
  {projection:{name:1,images:{$slice:2},shopifyImages:{$slice:2}}});
if(!p){console.log('NONE have a filled shopifyUrl');}
else{
  console.log('\nsample:',p.name);
  (p.images||[]).forEach((u,i)=>console.log('  images['+i+']      :',u));
  (p.shopifyImages||[]).forEach((s,i)=>{
    console.log('  pair['+i+'].sourceUrl:',s.sourceUrl);
    console.log('  pair['+i+'].shopifyUrl:',s.shopifyUrl||'(EMPTY)');
    console.log('  EXACT MATCH to images['+i+']?',(p.images||[])[i]===s.sourceUrl);
  });
}
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
