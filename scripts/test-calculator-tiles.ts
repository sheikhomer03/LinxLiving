import { quoteByArea } from '../src/lib/tileCalculator';

const testCases = [
  { name: "300x300", size: "300x300", price: 5.39 },
  { name: "400x400", size: "400x400", price: 9.60 },
  { name: "600x300", size: "600x300", price: 10.80 },
  { name: "600x600", size: "600x600", price: 21.58 }
];

testCases.forEach(tc => {
  const q = quoteByArea({
    pricePerSqm: 59.99,
    size: tc.size,
    sqmPerBox: null, // Ensure box logic doesn't interfere
    requestedM2: 1,
    boxPrice: null,
    roundToBox: false,
    roundToTile: true,
    tilePrice: tc.price,
    wastagePercent: 0
  });
  console.log(`--- ${tc.name} (1 m2, 0% wastage) ---`);
  console.log(`Tiles: ${q.tiles}`);
  console.log(`Price: £${q.total}`);
});
