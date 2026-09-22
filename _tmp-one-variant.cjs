require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient,ObjectId}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();
const p=await c.db('test').collection('products').findOne({_id:new ObjectId('6aaec02131afe0aa2b1194f8')});
console.log(p.name,'\nsource:',p.sourceUrl,'\n');
console.log('colorOptions:');
(p.colorOptions||[]).forEach(o=>console.log('  -',o.name,'\n      swatch:',o.swatchImage||'(none)'));
console.log('\nvariants:');
(p.variants||[]).forEach(v=>console.log('  -',v.name,'| sku',v.sku,'\n      imageUrl       :',v.imageUrl||'(none)','\n      shopifyImageUrl:',v.shopifyImageUrl||'(none)'));
console.log('\nproduct images:',(p.images||[]).length);
(p.images||[]).slice(0,8).forEach((u,i)=>console.log('  ['+i+']',u.slice(0,120)));
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
