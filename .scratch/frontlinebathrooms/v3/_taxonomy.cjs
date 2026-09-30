// read-only: category slugs in use in both clusters
const path=require("path");const ROOT=path.join(__dirname,"../../..");
require(path.join(ROOT,"node_modules/dotenv")).config({path:path.join(ROOT,".env.local"),quiet:true});
require("dns").setServers((process.env.MONGODB_DNS_SERVERS||"8.8.8.8").split(","));
const {MongoClient}=require(path.join(ROOT,"node_modules/mongodb"));
(async()=>{const out={};for(const [k,u] of [["usedDB1",process.env.MONGODB_URI],["usedDB2",process.env.MONGODB_URL2]]){const c=await MongoClient.connect(u);out[k]=await c.db().collection("products").aggregate([{$group:{_id:{d:"$department",c:"$category",s:"$subCategory"},n:{$sum:1}}}]).toArray();if(k==="usedDB1")out.departments=await c.db().collection("departments").find({}).project({slug:1,isActive:1}).toArray();await c.close()}
require("fs").writeFileSync(path.join(__dirname,"taxonomy.json"),JSON.stringify(out));console.log("saved",out.usedDB1.length,out.usedDB2.length)})();
