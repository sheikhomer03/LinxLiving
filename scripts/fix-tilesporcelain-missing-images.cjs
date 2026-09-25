const { connectMongo } = require("./mongo-connect.cjs");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    $expr: { $lte: [{ $size: { $ifNull: ["$images", []] } }, 1] }
  }).toArray();

  console.log(`Checking ${products.length} single-image products...`);
  
  let fixed = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    
    try {
      const res = await fetch(p.sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      
      const imgMatches = html.match(/"img":"([^"]+)"/g);
      if (imgMatches && imgMatches.length > 1) {
        // Extract the actual URLs and remove Magento cache hash to get original
        const urls = [...new Set(imgMatches.map(m => {
          let u = m.replace(/"img":"([^"]+)"/, "$1").replace(/\\\//g, "/");
          // Remove cache directory (e.g. /cache/68cc98e30e2a917236b3fe3faf831807/c/r/)
          return u.replace(/\/cache\/[a-f0-9]+\/[a-z0-9]\/[a-z0-9]\//, "/");
        }))];
        
        if (urls.length > 1) {
          await db.collection("products").updateOne(
            { _id: p._id },
            { $set: { images: urls } }
          );
          console.log(`Updated ${p.name} with ${urls.length} images`);
          fixed++;
        }
      }
    } catch (e) {
      failed++;
    }
    
    // Cloudflare delay
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nFinished! Fixed: ${fixed}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(console.error);
