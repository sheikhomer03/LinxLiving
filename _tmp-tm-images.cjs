require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient,ObjectId}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URL2,{serverSelectionTimeoutMS:20000});await c.connect();
const col=c.db('test').collection('products');
const ID=new ObjectId('6aabed1fef4d49fd99f1daf3'); // Tile Mountain
const n=await col.countDocuments({brand:ID});
if(!n) throw new Error('no Tile Mountain products - FAIL');
const cur=col.find({brand:ID},{projection:{shopifyImages:1,variants:1,images:1}});
let p=0,gal=0,galOk=0,v=0,vDirect=0,vMap=0,vEmpty=0,emptyGal=0,pairs=0,pairsWithUrl=0;
for await(const d of cur){
  p++;
  const map={};
  for(const s of d.shopifyImages||[]){pairs++; if(s.sourceUrl&&s.shopifyUrl){pairsWithUrl++; map[s.sourceUrl]=s.shopifyUrl;}}
  const imgs=d.images||[]; gal+=imgs.length;
  const r=imgs.filter(u=>map[u]||/cdn\.shopify\.com/.test(u)).length; galOk+=r;
  if(imgs.length&&!r) emptyGal++;
  for(const vr of d.variants||[]){v++;
    if(vr.shopifyImageUrl) vDirect++;
    else if(map[String(vr.imageUrl||'')]) vMap++;
    else vEmpty++;}
}
console.log('TILE MOUNTAIN (secondary cluster)');
console.log('  products:',p);
console.log('  shopifyImages pairs:',pairs,'| with shopifyUrl filled:',pairsWithUrl,'('+(pairs?(100*pairsWithUrl/pairs).toFixed(1):0)+'%)');
console.log('  gallery images:',gal,'| resolve to Shopify:',galOk,'('+(gal?(100*galOk/gal).toFixed(1):0)+'%)');
console.log('  products with EMPTY gallery:',emptyGal);
console.log('  variants:',v,'| direct shopifyImageUrl:',vDirect,'| via map:',vMap,'| EMPTY:',vEmpty);
const s=await col.findOne({brand:ID,'shopifyImages.0':{$exists:true}},{projection:{name:1,images:{$slice:1},shopifyImages:{$slice:1}}});
console.log('  sample images[0]:',(s.images||[])[0]);
console.log('  sample pair     :',JSON.stringify((s.shopifyImages||[])[0]));
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
