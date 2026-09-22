require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
const DOMAIN=(process.env.SHOPIFY_STORE_DOMAIN||'').trim();
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const cur=db.collection('products').find({brand:b._id},{projection:{name:1,shopifyImages:1}});
const stuck=[];
for await(const p of cur) for(const s of p.shopifyImages||[]) if(s.mediaId&&!s.shopifyUrl) stuck.push({id:s.mediaId,src:s.sourceUrl,name:p.name});
console.log('media with an id but no url:',stuck.length);
if(!stuck.length){await c.close();return;}
const t=await (await fetch('https://'+DOMAIN+'/admin/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET})})).json();
const ids=stuck.slice(0,50).map(s=>s.id);
const q=`query M($ids:[ID!]!){nodes(ids:$ids){... on MediaImage{id fileStatus fileErrors{code details} image{url}}}}`;
const r=await (await fetch('https://'+DOMAIN+'/admin/api/2024-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':t.access_token},body:JSON.stringify({query:q,variables:{ids}})})).json();
if(r.errors){console.log('GraphQL errors:',JSON.stringify(r.errors).slice(0,300));await c.close();return;}
const byStatus={};const errs={};let withUrl=0,missing=0;
for(const nd of r.data.nodes){
  if(!nd){missing++;continue;}
  byStatus[nd.fileStatus]=(byStatus[nd.fileStatus]||0)+1;
  if(nd.image&&nd.image.url) withUrl++;
  for(const e of nd.fileErrors||[]) errs[e.code]=(errs[e.code]||0)+1;
}
console.log('sample of 50 -> status:',JSON.stringify(byStatus),'| have image.url:',withUrl,'| node missing:',missing);
console.log('fileErrors:',JSON.stringify(errs));
const bad=r.data.nodes.find(n=>n&&(n.fileErrors||[]).length);
if(bad) console.log('example error:',JSON.stringify(bad.fileErrors[0]),'\n  source was:',(stuck.find(s=>s.id===bad.id)||{}).src);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
