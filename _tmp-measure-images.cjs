require('dotenv').config({path:'D:/OMER/linxLiving/LinxLiving/.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
async function stat(slug){
  const b=await db.collection('brands').findOne({slug});
  if(!b) return console.log(slug+': brand not found');
  const cur=db.collection('products').find({brand:b._id},{projection:{shopifyImages:1,variants:1,images:1}});
  let n=0,gal=0,galOk=0,v=0,vDirect=0,vMap=0,vEmpty=0,emptyGal=0;
  for await(const p of cur){
    n++;
    const map={};
    for(const s of p.shopifyImages||[]) if(s.sourceUrl&&s.shopifyUrl) map[s.sourceUrl]=s.shopifyUrl;
    const imgs=p.images||[]; gal+=imgs.length;
    const r=imgs.filter(u=>map[u]).length; galOk+=r;
    if(imgs.length&&!r) emptyGal++;
    for(const vr of p.variants||[]){v++;
      if(vr.shopifyImageUrl) vDirect++;
      else if(map[String(vr.imageUrl||'')]) vMap++;
      else vEmpty++;}
  }
  console.log(slug+': products '+n+' | gallery '+galOk+'/'+gal+' resolve ('+(gal?(100*galOk/gal).toFixed(1):0)+'%) | EMPTY galleries '+emptyGal);
  console.log('   variants '+v+' -> direct '+vDirect+', via map '+vMap+', EMPTY '+vEmpty);
}
await stat('toasty');
await stat('plank-hardware');
await stat('pooky');
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
