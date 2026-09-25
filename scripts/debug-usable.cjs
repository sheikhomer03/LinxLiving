require("tsx/cjs");
const { usableImageUrls } = require("../src/lib/shopify/sync-media.ts");
const images = [
  'https://tilesporcelain.co.uk/media/catalog/product/cr97m17tgrgarjlbtvncxsjaqlkokye90f8nntfm.jpg',
  'https://tilesporcelain.co.uk/media/catalog/product/pz8sn4ibgxs0hrntanfwb2szoqprmipy2tb2tttl.jpg',
  'https://tilesporcelain.co.uk/media/catalog/product/a37nvdlxv0luq0pspw7desahbjj4mluc7tnqwqui.jpg',
  'https://tilesporcelain.co.uk/media/catalog/product/t1bfi9jod4fe7wbtmjnhcbmysyuqfvzcrwefadzc.jpg',
  'https://tilesporcelain.co.uk/media/catalog/product/xahjp0hqztskxumsg6m2viudney6n4bnmtwbv3pp.jpg'
];
console.log(usableImageUrls(images));
