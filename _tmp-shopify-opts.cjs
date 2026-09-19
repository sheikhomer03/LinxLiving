require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
const D=(process.env.SHOPIFY_STORE_DOMAIN||'').trim();
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const p=await db.collection('products').findOne({brand:b._id,'variants.2':{$exists:true}},{projection:{name:1,shopifyProductId:1,variantGroups:1,variants:{$slice:3}}});
console.log('product:',p.name);
console.log('mongo variantGroups:',JSON.stringify(p.variantGroups));
console.log('mongo v0 option1/2:',JSON.stringify(p.variants[0].option1),JSON.stringify(p.variants[0].option2));
const t=await (await fetch('https://'+D+'/admin/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET})})).json();
const q=`query P($id:ID!){product(id:$id){title options{name position values} variants(first:3){nodes{id title selectedOptions{name value}}}}}`;
const r=await (await fetch('https://'+D+'/admin/api/2024-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':t.access_token},body:JSON.stringify({query:q,variables:{id:p.shopifyProductId}})})).json();
if(r.errors){console.log('errors',JSON.stringify(r.errors).slice(0,200));}
else{
  const pr=r.data.product;
  console.log('\nSHOPIFY options:',JSON.stringify(pr.options));
  console.log('SHOPIFY variants:',JSON.stringify(pr.variants.nodes.map(v=>({title:v.title,opts:v.selectedOptions}))).slice(0,300));
}
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
