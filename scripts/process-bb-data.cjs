const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.scratch', 'betterbathrooms');
const INPUT_FILE = path.join(DATA_DIR, 'bb-pdp.jsonl');
const OUTPUT_FILE = path.join(DATA_DIR, 'bb-grouped.json');

// Simple HTML entity decoder
function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&raquo;/g, "»")
    .replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n') // literal \n
    .replace(/\n+/g, '\n')
    .trim();
}

function getBaseName(name) {
  let bn = name;
  // Remove leading size like "500mm ", "600x400 "
  bn = bn.replace(/^(\d+(?:mm|cm|x\d+mm|\s*x\s*\d+mm)?)\s+/i, '');
  // Remove colour prefix
  bn = bn.replace(/^(White|Black|Grey|Beige|Oak|Walnut|Gloss|Matt|Chrome|Brass|Gold|Anthracite|Silver)\s+/i, '');
  return bn.trim();
}

function extractSizeFromName(name) {
  const match = name.match(/^(\d+(?:mm|cm|x\d+mm|\s*x\s*\d+mm)?)/i);
  return match ? match[1] : null;
}

function cleanSpecs(specs) {
  const clean = {};
  for (const [k, v] of Object.entries(specs)) {
    // Truncate key at first comma or parenthesis or newline
    let key = k.split(',')[0].split('(')[0].split('\n')[0].trim();
    if (key.length > 50) {
      key = key.substring(0, 50).trim();
    }
    clean[key] = v;
  }
  return clean;
}

function main() {
  console.log("Reading data...");
  const records = [];
  const lines = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (e) {}
  }

  console.log(`Parsed ${records.length} total records.`);

  // Stage 1: Clean & Deduplicate
  const uniqueRecords = new Map();
  for (const r of records) {
    if (!r.jsonLd) continue;
    const cleanUrl = r.url.split('##')[0];
    if (!uniqueRecords.has(cleanUrl)) {
      uniqueRecords.set(cleanUrl, r);
    }
  }

  const cleanData = Array.from(uniqueRecords.values());
  console.log(`After deduplication: ${cleanData.length} unique products.`);

  // Stage 2: Group Variants
  const groups = new Map();

  for (const r of cleanData) {
    const jsonLd = r.jsonLd;
    const name = jsonLd.name || '';
    const brand = jsonLd.brand && jsonLd.brand.name ? jsonLd.brand.name : 'Unknown';
    const base = getBaseName(name);
    const key = `${brand}|${base}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    
    // Clean description and specs
    const description = decodeHtml(jsonLd.description);
    const specs = r.tableSpecs ? cleanSpecs(r.tableSpecs) : {};
    
    const colour = jsonLd.color || null;
    const size = extractSizeFromName(name) || specs['Width'] || null;
    const price = jsonLd.offers ? jsonLd.offers.price : 0;
    
    let images = [];
    if (Array.isArray(jsonLd.image)) images = jsonLd.image;
    else if (typeof jsonLd.image === 'string') images = [jsonLd.image];

    groups.get(key).push({
      originalName: name,
      url: r.url,
      sourceUrl: r.sourceUrl,
      brand,
      baseName: base,
      colour,
      size,
      price,
      images,
      description,
      sku: jsonLd.sku,
      specs
    });
  }

  console.log(`Formed ${groups.size} unique base product groups.`);

  const mergedProducts = [];
  for (const [key, items] of groups.entries()) {
    const baseItem = items[0]; // use the first item as the base
    
    // If only one item, just format it and add
    if (items.length === 1) {
      mergedProducts.push({
        name: baseItem.originalName,
        brand: baseItem.brand,
        price: baseItem.price,
        images: baseItem.images,
        description: baseItem.description,
        sku: baseItem.sku,
        specs: baseItem.specs,
        sourceUrl: baseItem.sourceUrl,
        variants: [],
        shopifyOptions: []
      });
      continue;
    }

    // Multiple items -> create variants
    const allImages = new Set();
    items.forEach(i => i.images.forEach(img => allImages.add(img)));
    
    const uniqueImages = Array.from(allImages);
    const minPrice = Math.min(...items.map(i => i.price));

    const options = [];
    const sizes = Array.from(new Set(items.map(i => i.size).filter(Boolean)));
    const colours = Array.from(new Set(items.map(i => i.colour).filter(Boolean)));

    if (sizes.length > 0) options.push({ name: 'Size', values: sizes });
    if (colours.length > 0) options.push({ name: 'Colour', values: colours });

    const variants = items.map((item, idx) => {
      return {
        name: item.originalName,
        sku: item.sku,
        price: item.price,
        imageUrl: item.images[0] || null,
        option1: sizes.length > 0 ? item.size || 'Default' : (colours.length > 0 ? item.colour || 'Default' : `Variant ${idx+1}`),
        option2: sizes.length > 0 && colours.length > 0 ? item.colour || 'Default' : null,
        options: {
          ...(sizes.length > 0 && { Size: item.size || 'Default' }),
          ...(colours.length > 0 && { Colour: item.colour || 'Default' })
        }
      };
    });

    mergedProducts.push({
      name: baseItem.baseName,
      brand: baseItem.brand,
      price: minPrice,
      images: uniqueImages,
      description: baseItem.description,
      sku: baseItem.sku,
      specs: baseItem.specs,
      sourceUrl: baseItem.sourceUrl,
      shopifyOptions: options,
      variants: variants
    });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mergedProducts, null, 2));
  console.log(`\nSuccessfully saved ${mergedProducts.length} final products to ${OUTPUT_FILE}`);
  
  // Show a couple of samples
  console.log("\n--- SAMPLE OUTPUT ---");
  const multiVariants = mergedProducts.filter(p => p.variants.length > 1);
  console.log("Sample merged product:");
  console.log(JSON.stringify(multiVariants[0], null, 2).substring(0, 1000) + "\n...[truncated]...");
  
  const singleVariant = mergedProducts.filter(p => p.variants.length === 0);
  console.log("\nSample single product:");
  console.log(JSON.stringify(singleVariant[0], null, 2).substring(0, 1000) + "\n...[truncated]...");
}

main();
