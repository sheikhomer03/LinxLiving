require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
// Mirrors buildShopifyFallbackMap + withShopifyOptionImages (productImage.ts).
function build(pairs){const m={};for(const p of pairs||[]){const s=String(p?.sourceUrl||'').trim(),y=String(p?.shopifyUrl||'').trim();if(!s||!y)continue;m[s]=y;m[y]=y;}return m;}
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const cur=db.collection('products').find({brand:b._id},{projection:{name:1,shopifyImages:1,variants:1,images:1}});
let n=0,gal=0,ok=0,empty=0,v=0,vOk=0,vEmpty=0;const emptyNames=[];
for await(const p of cur){
  n++;const map=build(p.shopifyImages);
  const imgs=(p.images||[]).map(u=>map[String(u||'')]||'').filter(Boolean);
  gal+=(p.images||[]).length; ok+=imgs.length;
  if(!imgs.length){empty++; if(emptyNames.length<8) emptyNames.push(p.name);}
  for(const r of p.variants||[]){v++;
    const u=String(r.shopifyImageUrl||'')||map[String(r.imageUrl||'')]||'';
    if(u) vOk++; else vEmpty++;}
}
console.log('TOASTY (resolved exactly as the storefront does)');
console.log('  products:',n);
console.log('  gallery images:',gal,'-> render',ok,'('+(100*ok/gal).toFixed(1)+'%)');
console.log('  products rendering ZERO images:',empty);
if(emptyNames.length) console.log('   e.g.',emptyNames.join(' | '));
console.log('  variants:',v,'-> with image',vOk,'| without',vEmpty);
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
