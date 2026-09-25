import { quoteByArea } from '../src/lib/tileCalculator';

const testCases = [
  { name: "Super Black Polished Porcelain Tiles-600x600", size: "600x600", price: 7.19 }, // Using a guess for price, let's just make sure the area parsing is right
];

testCases.forEach(tc => {
  const q = quoteByArea({
    pricePerSqm: 19.97, // Guess
    size: tc.size,
    sqmPerBox: null,
    requestedM2: 1,
    boxPrice: null,
    roundToBox: false,
    roundToTile: true,
    tilePrice: tc.price,
    wastagePercent: 0
  });
  console.log(`--- ${tc.name} (1 m2, 0% wastage) ---`);
  console.log(`Tiles: ${q.tiles}`);
});
