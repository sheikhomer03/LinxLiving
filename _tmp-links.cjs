require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const rows=await db.collection('products').aggregate([
 {$match:{brand:b._id,category:{$nin:[null,'']}}},
 {$sample:{size:10}},
 {$project:{name:1,sourceUrl:1,price:1,
   colours:{$size:{$ifNull:['$colorOptions',[]]}},
   axes:{$ifNull:['$shopifyOptions',[]]},
   vars:{$size:{$ifNull:['$variants',[]]}},
   imgs:{$size:{$ifNull:['$images',[]]}}}}]).toArray();
rows.forEach((p,i)=>{
 const axisNames=(p.axes||[]).map(a=>a.name).join(', ')||'none';
 console.log('\n'+(i+1)+'. '+p.name);
 console.log('   LOCAL : http://localhost:3000/products/'+p._id);
 console.log('   SITE  : '+p.sourceUrl);
 console.log('   GBP '+p.price+' | colours '+p.colours+' | picker axes: '+axisNames+' | variants '+p.vars+' | images '+p.imgs);
});
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
