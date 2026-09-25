const { connectMongo } = require("./mongo-connect.cjs");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain"
  }).toArray();

  console.log(`Checking ${products.length} Tiles Porcelain products...`);
  
  let fixed = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    
    try {
      const res = await fetch(p.sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      
      const match = html.match(/basePrice\s*=\s*parseFloat\(['"]([0-9.]+)['"]\)/);
      if (!match) {
        const offerMatch = html.match(/"price"\s*:\s*"([0-9.]+)"/);
        if (offerMatch) {
          const incVat = parseFloat(offerMatch[1]);
          if (Math.abs(p.price - incVat) > 0.05) {
            console.log(`Fixing ${p.name}: ${p.price} -> ${incVat}`);
            await db.collection("products").updateOne(
              { _id: p._id },
              { $set: { price: incVat, "specs.pricePerM2": Number(((p.specs?.pricePerM2 || 0) / p.price * incVat).toFixed(2)) } }
            );
            fixed++;
          }
        } else {
          failed++;
        }
      } else {
        const exVat = parseFloat(match[1]);
        const incVat = Number((exVat * 1.2).toFixed(2));
        
        let pricePerSqmIncVat = null;
        if (p.specs?.tilesPerSqm) {
           pricePerSqmIncVat = Number((incVat * p.specs.tilesPerSqm).toFixed(2));
        }

        const updates = { price: incVat };
        if (pricePerSqmIncVat) updates["specs.pricePerM2"] = pricePerSqmIncVat;

        if (Math.abs(p.price - incVat) > 0.05) {
          console.log(`Fixing ${p.name}: ${p.price} -> ${incVat}`);
          await db.collection("products").updateOne({ _id: p._id }, { $set: updates });
          fixed++;
        }
      }
    } catch (e) {
      failed++;
    }
    
    if (i % 20 === 0) process.stdout.write(".");
    
    // Cloudflare delay
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nFinished! Fixed: ${fixed}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(console.error);
