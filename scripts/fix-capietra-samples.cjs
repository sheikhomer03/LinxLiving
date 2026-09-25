const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const mongoose = require("mongoose");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  
  const brand = await conn.db.collection("brands").findOne({ slug: "capietra" });
  if (!brand) throw new Error("Brand not found");

  const products = await conn.db.collection("products")
    .find({ brand: brand._id })
    .toArray();
    
  console.log(`Found ${products.length} Ca'Pietra products.`);

  // Group by base URL
  const byUrl = {};
  products.forEach(p => {
    const baseUrl = p.sourceUrl.split('?')[0];
    if (!byUrl[baseUrl]) byUrl[baseUrl] = [];
    byUrl[baseUrl].push(p);
  });

  let toDelete = [];
  let toRename = [];

  for (const url in byUrl) {
    const group = byUrl[url];
    
    // To safely identify samples without deleting standalone cheap accessories:
    // Only target items under £5 if they share a base URL with a more expensive variant.
    const samples = group.filter(p => p.price > 0 && p.price < 5);
    const reals = group.filter(p => p.price >= 5 || p.price === 0);

    // If this base URL has REAL products, then the cheap ones are just sample variants!
    if (reals.length > 0) {
      samples.forEach(s => toDelete.push(s));
    }

    // If there is EXACTLY ONE real variant (meaning only 1 true size), strip its size from the name
    if (reals.length === 1) {
      const real = reals[0];
      // Regex to match trailing dimensions like " 24.5x21.5" or " 61 x 61 x 1.0cm" or " 60x60"
      const cleanedName = real.name.replace(/\s+[\d\.]+(\s*(x|X)\s*[\d\.]+)+(\s*cm)?$/i, "").trim();
      
      if (cleanedName !== real.name) {
        toRename.push({
          id: real._id,
          oldName: real.name,
          newName: cleanedName
        });
      }
    }
  }

  console.log(`\n\x1b[1m--- SAMPLES TO DELETE (${toDelete.length}) ---\x1b[0m`);
  toDelete.forEach(d => console.log(`[DELETE] £${d.price.toFixed(2)} - ${d.name} (${d.sourceUrl})`));

  console.log(`\n\x1b[1m--- PRODUCTS TO RENAME (${toRename.length}) ---\x1b[0m`);
  toRename.forEach(r => console.log(`[RENAME] "${r.oldName}"  ==>  "${r.newName}"`));

  if (DRY_RUN) {
    console.log(`\n\x1b[33mDRY RUN COMPLETE. No changes made. Run without --dry-run to execute.\x1b[0m`);
  } else {
    console.log(`\n\x1b[1mExecuting changes...\x1b[0m`);
    
    // Execute Deletions
    if (toDelete.length > 0) {
      const deleteIds = toDelete.map(d => d._id);
      const delRes = await conn.db.collection("products").deleteMany({ _id: { $in: deleteIds } });
      console.log(`Deleted ${delRes.deletedCount} sample products.`);
    }

    // Execute Renames
    let renameCount = 0;
    for (const r of toRename) {
      const res = await conn.db.collection("products").updateOne(
        { _id: r.id },
        { $set: { name: r.newName } }
      );
      if (res.modifiedCount > 0) renameCount++;
    }
    console.log(`Renamed ${renameCount} single-size products.`);
    console.log(`\n\x1b[32mDONE!\x1b[0m`);
  }

  await conn.close();
  process.exit(0);
}

main().catch(console.error);
