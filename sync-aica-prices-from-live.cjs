require('dotenv').config({ path: '.env.local' });
const { connectMongo } = require('./scripts/mongo-connect.cjs');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const { db, mongoose } = await connectMongo();
  const { db: db2, mongoose: mongoose2 } = await connectMongo(process.env.MONGODB_URL2);

  const brand = await db.collection('brands').findOne({ name: 'Aica Bathrooms' });
  const products = await db2.collection('products').find({ 
    brand: brand._id,
    sourceUrl: { $regex: 'aicabathrooms.co.uk' }
  }).toArray();

  console.log(`Syncing prices for ${products.length} Aica products from live site...`);
  
  let fixed = 0, skipped = 0, errors = 0;
  const bulkOps = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const handle = (p.sourceUrl || '').split('/products/')[1];
    if (!handle) { skipped++; continue; }

    try {
      const res = await fetch(`https://www.aicabathrooms.co.uk/products/${handle}.json`);
      if (!res.ok) { skipped++; continue; }
      const data = await res.json();
      const liveVariants = data?.product?.variants || [];
      if (!liveVariants.length) { skipped++; continue; }

      const newVariants = p.variants.map(v => {
        const newV = { ...v, available: true };
        // Match by SKU first, then by title
        const liveV = liveVariants.find(lv => lv.sku === v.sku) ||
                      liveVariants.find(lv => lv.title?.toLowerCase().trim() === v.name?.toLowerCase().trim());
        if (liveV) {
          newV.price = parseFloat(liveV.price);
          if (liveV.compare_at_price) {
            newV.compareAtPrice = parseFloat(liveV.compare_at_price);
          } else {
            delete newV.compareAtPrice;
          }
        }
        return newV;
      });

      // Compute product-level prices from variants
      const prices = newVariants.map(v => v.price).filter(x => x > 0);
      const comparePrices = newVariants.map(v => v.compareAtPrice).filter(x => x != null && x > 0);
      const newPrice = prices.length ? Math.min(...prices) : p.price;
      const newCompare = comparePrices.length ? Math.min(...comparePrices) : null;

      const $set = {
        variants: newVariants,
        price: newPrice,
        isOutOfStock: false,
        stockStatus: 'in_stock'
      };
      if (newCompare) {
        $set.compareAtPrice = newCompare;
        $set['specs.compareAtPrice'] = newCompare;
      }
      
      // Clear salePercent if it exists
      const $unset = {};
      if (p.specs?.salePercent != null) $unset['specs.salePercent'] = '';
      if (p.specs?.salePriceMode) $unset['specs.salePriceMode'] = '';

      const op = { updateOne: { filter: { _id: p._id }, update: { $set } } };
      if (Object.keys($unset).length > 0) op.updateOne.update.$unset = $unset;
      bulkOps.push(op);
      fixed++;

      if (i % 50 === 0) {
        console.log(`Processed ${i}/${products.length}...`);
      }

      // Flush every 100 ops
      if (bulkOps.length >= 100) {
        await db2.collection('products').bulkWrite(bulkOps.splice(0, 100), { ordered: false });
      }

      // Rate limit: be gentle on Aica's servers
      await sleep(200);
    } catch (e) {
      errors++;
      if (errors <= 5) console.error('Error on', p.sourceUrl, ':', e.message);
    }
  }

  // Final flush
  if (bulkOps.length > 0) {
    await db2.collection('products').bulkWrite(bulkOps, { ordered: false });
  }

  console.log(`\nDone! Fixed: ${fixed}, Skipped: ${skipped}, Errors: ${errors}`);
  process.exit(0);
}

run().catch(console.error);
