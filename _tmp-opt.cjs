require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient,ObjectId}=require('mongodb');
(async()=>{
const pri=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await pri.connect();
const b=await pri.db('test').collection('brands').findOne({slug:'toasty'});
const t=await pri.db('test').collection('products').findOne({brand:b._id,'variants.1':{$exists:true}},{projection:{name:1,variantGroups:1,variants:{$slice:2}}});
console.log('TOASTY:',t.name);
console.log('  variantGroups:',JSON.stringify(t.variantGroups));
t.variants.forEach((v,i)=>console.log('  v'+i+': options='+JSON.stringify(v.options)+' option1='+JSON.stringify(v.option1)+' option2='+JSON.stringify(v.option2)));
const col=pri.db('test').collection('products');
console.log('  products w/ >=1 variant having option1 set:',await col.countDocuments({brand:b._id,'variants.option1':{$nin:[null,'']}}));
console.log('  products w/ >=2 variants                  :',await col.countDocuments({brand:b._id,'variants.1':{$exists:true}}));
await pri.close();
const sec=new MongoClient(process.env.MONGODB_URL2,{serverSelectionTimeoutMS:20000});await sec.connect();
const sc=sec.db('test').collection('products');
const D=new ObjectId('6aa9099e8b8dba35250c3855'); // Drench
const d=await sc.findOne({brand:D,'variants.1':{$exists:true}},{projection:{name:1,variantGroups:1,variants:{$slice:2}}});
console.log('\nDRENCH (working reference):',d?d.name:'none');
if(d){console.log('  variantGroups:',JSON.stringify(d.variantGroups));
d.variants.forEach((v,i)=>console.log('  v'+i+': options='+JSON.stringify(v.options)+' option1='+JSON.stringify(v.option1)+' option2='+JSON.stringify(v.option2)));
console.log('  products w/ >=1 variant having option1 set:',await sc.countDocuments({brand:D,'variants.option1':{$nin:[null,'']}}));
console.log('  products w/ >=2 variants                  :',await sc.countDocuments({brand:D,'variants.1':{$exists:true}}));}
await sec.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
