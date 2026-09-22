require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});const col=db.collection('products');
console.log('products with colorOptions:',await col.countDocuments({brand:b._id,'colorOptions.0':{$exists:true}}));
console.log('  with a swatchImage set  :',await col.countDocuments({brand:b._id,'colorOptions.swatchImage':{$nin:[null,'']}}));
console.log('  swatch on cdn.shopify   :',await col.countDocuments({brand:b._id,'colorOptions.swatchImage':/cdn\.shopify\.com/}));
const s=await col.findOne({brand:b._id,'colorOptions.2':{$exists:true}},{projection:{name:1,colorOptions:1}});
console.log('\nsample:',s.name);
s.colorOptions.slice(0,4).forEach(o=>console.log('   -',o.name,'| swatch:',o.swatchImage?'yes':'MISSING','| sap:',o.sap||'-'));
console.log('   LOCAL: http://localhost:3000/products/'+s._id);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
