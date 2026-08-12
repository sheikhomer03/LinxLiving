const fs=require("fs");
for(const l of fs.readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)process.env[m[1]]=m[2].trim();}
const mongoose=require("mongoose");
const path=require("path");
const APPLY=process.argv.includes("--apply");
const ROLLBACK=process.argv.indexOf("--rollback")>-1?process.argv[process.argv.indexOf("--rollback")+1]:null;
/** Same rule the navbar uses (lib/accessories.ts). */
const ACCESSORY_RX=/accessor|fixing|flashing|adhesive|grout|underlay|sealant|fastener|spare|trim/i;
(async()=>{await mongoose.connect(process.env.MONGODB_URI);
const P=mongoose.connection.collection("products");
const M=mongoose.connection.collection("menus");
const D=mongoose.connection.collection("departments");

if(ROLLBACK){
  const d=JSON.parse(fs.readFileSync(ROLLBACK,"utf8"));
  for(const p of d.products) await P.updateOne({_id:new mongoose.Types.ObjectId(p._id)},{$set:{department:p.department}});
  for(const m of d.menus) await M.updateOne({_id:new mongoose.Types.ObjectId(m._id)},{$set:{department:m.department?new mongoose.Types.ObjectId(m.department):null}});
  console.log(`Rolled back ${d.products.length} products, ${d.menus.length} menus.`);
  await mongoose.disconnect();return;
}

const accDept=await D.findOne({slug:"accessories"});
if(!accDept) throw new Error("accessories department missing");

// Scoped to The Under Floor Heating. Other brands' accessory ranges are left
// where they are — moving FAKRO's blinds-accessories out of Rooflights &
// Glass, for instance, was not asked for and would empty a real column.
const B=mongoose.connection.collection("brands");
const brand=await B.findOne({slug:"the-under-floor-heating"});
if(!brand) throw new Error("Under Floor Heating brand missing");

// Accessory categories currently sitting in a product department other than
// accessories. Heating should hold heating products only.
const cats=(await P.distinct("category",{brand:brand._id,category:{$nin:["",null]}})).filter(c=>ACCESSORY_RX.test(c));
const products=await P.find({brand:brand._id,category:{$in:cats},department:{$ne:"accessories"}}).project({_id:1,department:1,category:1}).toArray();
const menus=await M.find({brand:brand._id,slug:{$in:cats}}).project({_id:1,slug:1,department:1}).toArray();

console.log(APPLY?"=== APPLYING ===":"=== DRY RUN ===");
console.log("accessory categories:",cats.join(", "));
console.log(`products to move : ${products.length}`);
console.log(`menus to relink  : ${menus.length}`);
const byDept={};
products.forEach(p=>{byDept[p.department||"(none)"]=(byDept[p.department||"(none)"]||0)+1;});
console.log("  from departments:",JSON.stringify(byDept));

if(!APPLY){console.log("\nRe-run with --apply");await mongoose.disconnect();return;}

const backup={products:products.map(p=>({_id:String(p._id),department:p.department??""})),
              menus:menus.map(m=>({_id:String(m._id),department:m.department?String(m.department):null}))};
const file=path.join(process.cwd(),"rollback-accessories-move.json");
fs.writeFileSync(file,JSON.stringify(backup,null,2));
console.log("\nRollback file:",path.basename(file));

const pr=await P.updateMany({brand:brand._id,category:{$in:cats},department:{$ne:"accessories"}},{$set:{department:"accessories"}});
const mr=await M.updateMany({brand:brand._id,slug:{$in:cats}},{$set:{department:accDept._id,updatedAt:new Date()}});
console.log(`Products moved  : ${pr.modifiedCount}`);
console.log(`Menus relinked  : ${mr.modifiedCount}`);
await mongoose.disconnect();})().catch(e=>{console.error(e.message);process.exit(1);});
