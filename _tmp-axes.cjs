require('dotenv').config({path:'.env',quiet:true});
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const {MongoClient}=require('mongodb');
(async()=>{
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});await c.connect();const db=c.db('test');
const b=await db.collection('brands').findOne({slug:'toasty'});
const cur=db.collection('products').find({brand:b._id,'shopifyOptions.0':{$exists:true}},{projection:{shopifyOptions:1,variants:1}});
const names={};let prods=0,vWithArr=0,vTotal=0,apprAxis=0;
const APPR=/^(finish|colour|color|shade|texture)$/i;
for await(const p of cur){prods++;
  for(const o of p.shopifyOptions||[]){const n=String(o.name||'').trim();names[n]=(names[n]||0)+1;if(APPR.test(n))apprAxis++;}
  for(const v of p.variants||[]){vTotal++;if((v.shopifyImages||[]).some(x=>x&&x.shopifyUrl))vWithArr++;}
}
console.log('multi-variant products:',prods,'| axes matching finish/colour/...:',apprAxis);
console.log('\naxis names (top 15):');
Object.entries(names).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([n,c])=>console.log('  '+String(c).padStart(4),JSON.stringify(n)));
console.log('\nvariants:',vTotal,'| with a populated variants[].shopifyImages:',vWithArr,'  <- what pictureFor reads');
await c.close();})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
