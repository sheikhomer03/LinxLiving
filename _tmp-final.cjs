require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
function build(pairs){const m={};for(const p of pairs||[]){const s=String(p?.sourceUrl||'').trim(),y=String(p?.shopifyUrl||'').trim();if(!s||!y)continue;m[s]=y;m[y]=y;}return m;}
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const col=db.collection('products');
// Picker gate: variantAxes.length > 0 && catalogVariants.length > 1
const willRender=await col.countDocuments({brand:b._id,'shopifyOptions.0':{$exists:true},'variants.1':{$exists:true}});
console.log('products that will render the variant picker:',willRender,'of',await col.countDocuments({brand:b._id}));
const cur=col.find({brand:b._id},{projection:{name:1,shopifyImages:1,variants:1,images:1}});
let gal=0,ok=0,empty=0,v=0,vOk=0;
for await(const p of cur){const m=build(p.shopifyImages);
 const imgs=(p.images||[]).map(u=>m[String(u||'')]||'').filter(Boolean);
 gal+=(p.images||[]).length; ok+=imgs.length; if(!imgs.length) empty++;
 for(const r of p.variants||[]){v++; if(String(r.shopifyImageUrl||'')||m[String(r.imageUrl||'')]) vOk++;}}
console.log('gallery images:',gal,'-> render',ok,'('+(100*ok/gal).toFixed(1)+'%) | products with ZERO images:',empty);
console.log('variants:',v,'-> with image',vOk,'('+(100*vOk/v).toFixed(1)+'%)');
const s=await col.findOne({brand:b._id,'shopifyOptions.0':{$exists:true},'variants.2':{$exists:true}},{projection:{name:1,shopifyOptions:1}});
console.log('\nsample:',s.name);
console.log('  shopifyOptions:',JSON.stringify(s.shopifyOptions));
console.log('  LOCAL: http://localhost:3000/products/'+s._id);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
