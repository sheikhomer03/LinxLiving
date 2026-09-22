/**
 * Set variants[].shopifyImageUrl by joining on the supplier's content hash.
 *
 * The storefront resolves a variant picture as `shopifyImageUrl` first and the
 * gallery pair map second. The media repair rebuilt this brand's pairs from
 * `images[]`, which by then held Shopify URLs, so the map lost its
 * source->Shopify keys and every variant still holding a supplier URL missed.
 * Writing the field the chain reads first makes the variant independent of how
 * the pair map happens to be keyed.
 *
 * The join key is the 40-char hex hash the supplier puts at the front of every
 * filename; Shopify keeps it when it renames the file on upload.
 *
 *   BRAND=toasty [APPLY=1] node _tmp-fix-variant-images.cjs
 */
require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
const APPLY=process.env.APPLY==='1';
const SLUG=process.env.BRAND||'toasty';
const hash=(u)=>{const m=String(u||'').match(/([0-9a-f]{40})/i);return m?m[1].toLowerCase():'';};
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:SLUG});
if(!b) throw new Error('brand not found: '+SLUG);
const col=db.collection('products');
const cur=col.find({brand:b._id},{projection:{shopifyImages:1,variants:1,images:1}});
let prods=0,ops=[],set=0,already=0,noMatch=0,vTotal=0;
for await(const p of cur){
  prods++;
  const byHash={};
  for(const s of p.shopifyImages||[]){
    const u=String(s.shopifyUrl||'');
    if(!u) continue;
    const h=hash(u)||hash(s.sourceUrl);
    if(h&&!byHash[h]) byHash[h]=u;
  }
  const upd={};
  (p.variants||[]).forEach((v,i)=>{
    vTotal++;
    if(v.shopifyImageUrl){already++;return;}
    const h=hash(v.imageUrl);
    const hit=h?byHash[h]:'';
    if(!hit){noMatch++;return;}
    upd['variants.'+i+'.shopifyImageUrl']=hit;
    set++;
  });
  if(Object.keys(upd).length) ops.push({updateOne:{filter:{_id:p._id},update:{$set:upd}}});
}
console.log((APPLY?'APPLY':'DRY')+' · products '+prods+' · variants '+vTotal);
console.log('  already set:',already,'| would set:',set,'| no hash match:',noMatch);
if(APPLY&&ops.length){
  let mod=0;
  for(let i=0;i<ops.length;i+=200){
    const r=await col.bulkWrite(ops.slice(i,i+200),{ordered:false});
    mod+=r.modifiedCount;
  }
  console.log('  products modified:',mod);
}
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
