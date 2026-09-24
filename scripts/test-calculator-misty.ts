import { quoteByArea } from '../src/lib/tileCalculator';

const sizes = ['600x300', '600x600', '1200x600'];
const prices = [3.88, 7.76, 17.24];
const pSqm = [21.56, 21.56, 23.96];

sizes.forEach((s, i) => {
  const q = quoteByArea({
      pricePerSqm: pSqm[i],
      size: s,
      sqmPerBox: null,
      requestedM2: 1,
      boxPrice: null,
      roundToBox: false,
      roundToTile: true,
      tilePrice: prices[i],
      wastagePercent: 0
  });
  console.log(`${s} (1 m2): Tiles=${q.tiles}, Price=£${q.total}`);
});
