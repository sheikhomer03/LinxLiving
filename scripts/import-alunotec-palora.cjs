/**
 * AlunoTec — brand, the four Palora categories, and every product they sell.
 *
 * Source: the four "260731 … Price List - AlunoTec Connie.pdf" quotations in
 * public/AlunoTec-Cassette-Awning. Each quotation lists three families — the
 * pergola itself, a zipped blind, and a frameless sliding door — so a category
 * is not one product but three.
 *
 * The pergola differs per quotation (price, LED, operation) so it is modelled
 * once per category. The blind and the door are identical between the manual
 * and motorized quotations of the same profile, so each is modelled once and
 * listed in both categories rather than duplicated. Every priced row from
 * every file lands on exactly one variant; nothing is dropped.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-alunotec-palora.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/import-alunotec-palora.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/import-alunotec-palora.cjs --rollback <file.json>
 *
 * PRICES ARE THE QUOTATION'S FIGURES, UNCONVERTED. The price lists print US$
 * FOB Dongguan — no shipping, no duty, no destination-port cost, and no retail
 * margin — while the storefront renders GBP. Confirm the currency, the landed
 * cost and the markup before these go live. Same caveat as the Oscar import.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const BRAND_SLUG = "alunotec";
const BRAND_NAME = "AlunoTec";
/**
 * Storefront label. Suppliers are not named on the shop front — every brand
 * shows as LINX Square — so this matches Oscar and the rest of the catalogue.
 * `name` stays "AlunoTec" for admin, filtering and the pricing rules.
 */
const BRAND_UI_NAME = "Linx Square";
const DEPARTMENT = "outdoor-living";
const DEPARTMENT_ID = "6a6dd46b95ee1f7043b9f257";
const DOC_DIR = "/AlunoTec-Cassette-Awning";

const IMAGES = require("./alunotec-image-manifest.json");
/** A missing key would silently publish a product with no photography. */
function img(key) {
  const url = IMAGES[key];
  if (!url) throw new Error(`Image not in manifest: ${key}`);
  return url;
}

// ---------------------------------------------------------------- categories
const CATEGORIES = [
  { slug: "motorized-palora-p6", name: "Motorized Palora P6" },
  { slug: "manual-palora-p6", name: "Manual Palora P6" },
  { slug: "motorized-palora-p4", name: "Motorized Palora P4" },
  { slug: "manual-palora-p4", name: "Manual Palora P4" },
];

// ------------------------------------------------------------------ supplier
/** Printed identically on all four quotations. */
const TERMS = [
  [
    "Delivery Term",
    "FOB, including China inland delivery cost, customs clearance of China, " +
      "not including shipping cost or any cost of the destination port.",
  ],
  [
    "Payment Term",
    "40% T/T deposit and 60% balance should be paid upon order completion and prior to shipping.",
  ],
  ["Production Time", "25-30 work days after receiving the deposit & confirming drawings."],
  ["Packing", "Carton box packaging with protective measures."],
  ["Validity", "15 days, price is subject to exchange rate, material cost etc."],
  ["Quotation Date", "2026/7/31"],
];

/**
 * The quotation's letterhead names the factory and its sales contact. That is
 * supplier-facing detail, not shop-front copy — the storefront presents every
 * brand as LINX Square — so it is deliberately not published on the PDP.
 */

function sections() {
  return [
    {
      heading: "Terms & Conditions",
      text: "",
      rows: TERMS.map(([label, value]) => ({ label, value })),
    },
  ];
}

/**
 * Customer-facing documents only. The price lists themselves stay off the PDP:
 * they are trade quotations carrying FOB cost and the factory's contact
 * details, which is not something to publish on a retail product page.
 */
const AWNING_CATALOGUE = {
  name: "AlunoTec Cassette Awning Catalogue (PDF)",
  url: encodeURI(`${DOC_DIR}/AlunoTec Cassette Awning Catalog.pdf`),
};

const P6_CATALOGUE = {
  name: "AlunoTec Palora P6 Catalogue (PDF)",
  url: encodeURI(`${DOC_DIR}/AlunoTec Palora P6 Catalog.pdf`),
};

/**
 * Shown in the Warranty tab. AlunoTec issued one warranty document, written
 * for the Palora P6; the P4 products carry the same file because there is no
 * P4 equivalent to give them.
 */
const WARRANTY_FILES = [
  {
    name: "Palora P6 Warranty (PDF)",
    url: encodeURI(`${DOC_DIR}/Palora P6 Warranty.pdf`),
  },
];

/** Catalogues, shown as the Manuals accordion inside the Description tab. */
function manualsFor(modelNumber) {
  return modelNumber === "P6"
    ? [P6_CATALOGUE, AWNING_CATALOGUE]
    : [AWNING_CATALOGUE];
}

// -------------------------------------------------------------- price tables
/**
 * Every row is transcribed from the quotation in its printed order, including
 * the columns that print "/" — those become null rather than being dropped, so
 * a reader can tell "not offered" from "not yet transcribed".
 *
 * unit  = "1 Unit Price"   US$/Unit
 * cont  = "1X40HQ Price"   US$/Unit at full-container quantity
 */

/** Pergola rows: [nr, L, W, unit, cont]. Height, bay and post are fixed per model. */
const P6_MOTORIZED_ROWS = [
  [1, 3000, 3000, 2784, 2252],
  [2, 3000, 4000, 3223, 2658],
  [3, 3000, 5000, 3633, 3039],
  [4, 3000, 6000, 4060, 3419],
  [5, 4000, 4000, 3749, 3144],
  [6, 4000, 5000, 4325, 3631],
  [7, 4000, 6000, 4949, 4171],
];

const P6_MANUAL_ROWS = [
  [1, 3000, 3000, 2598, 2080],
  [2, 3000, 4000, 3037, 2486],
  [3, 3000, 5000, 3447, 2867],
  [4, 3000, 6000, 3874, 3246],
  [5, 4000, 4000, 3563, 2972],
  [6, 4000, 5000, 4139, 3459],
  [7, 4000, 6000, 4763, 3999],
];

const P4_MOTORIZED_ROWS = [
  [1, 3000, 3000, null, 1661],
  [2, 3000, 4000, null, 1937],
  [3, 4000, 4000, null, 2752],
  [4, 6000, 4000, null, 3521],
];

const P4_MANUAL_ROWS = [
  [1, 3000, 3000, null, 1406],
  [2, 3000, 4000, null, 1667],
  [3, 4000, 4000, null, 2240],
  [4, 6000, 4000, null, 2987],
];

/** Blind rows: [nr, side label, W, H, unit, cont]. */
const P6_BLIND_ROWS = [
  [8, "3m side", 2608, 2298, 391, null],
  [9, "4m side", 3608, 2298, 472, null],
  [10, "5m side", 4608, 2298, 538, null],
  [11, "6m side", 5608, 2298, 612, null],
];

const P4_BLIND_ROWS = [
  [5, "3m side", 2608, 2298, null, 236],
  [6, "4m side", 3608, 2298, null, 291],
];

/** Door rows: [nr, side label, W, H, tracks, panels, unit]. */
const P6_DOOR_ROWS = [
  [12, "3m side", 2607, 2297, 3, 3, 563],
  [13, "4m side", 3607, 2297, 4, 4, 779],
  [14, "6m side", 5607, 2294, 3, 6, 996],
  [15, "6m side", 5607, 2294, 3, 6, 1212],
];

const P4_DOOR_ROWS = [
  [7, "3m side", 2607, 2297, 3, 3, 563],
  [8, "4m side", 3607, 2297, 4, 4, 779],
];

// ----------------------------------------------------------------- utilities
const money = (v) =>
  v == null ? "—" : `US$${Number(v).toLocaleString("en-US")}`;
const metres = (mm) => `${(mm / 1000).toFixed(1)} m`;

/** `price` is what we sell at, so fall back to the container rate when the
 *  quotation prices a line only by the container. */
const sellPrice = (unit, cont) => (unit != null ? unit : cont);

function attrs(pairs) {
  return pairs
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

// ------------------------------------------------------------------ pergolas
function buildPergola({
  handle,
  name,
  categorySlug,
  modelNumber,
  series,
  rows,
  heightMm,
  operation,
  ledLouver,
  ledGutter,
  profile,
  features,
  images,
  source,
}) {
  const variants = rows.map(([nr, l, w, unit, cont], i) => ({
    name: `${metres(l)} × ${metres(w)}`,
    sku: `${modelNumber}-${l / 1000}X${w / 1000}`,
    option1: `${metres(l)} × ${metres(w)}`,
    price: sellPrice(unit, cont),
    containerPrice: cont,
    stock: 25,
    position: i + 1,
    isDefault: i === 0,
    externalId: `${source}#${nr}`,
    dimensionsMm: { lengthMm: l, widthMm: w, heightMm: heightMm },
    attributes: attrs([
      ["Quotation row", `Nr. ${nr}`],
      ["Series", series],
      ["Model number", modelNumber],
      ["Design type", "FS (freestanding)"],
      ["Bay", "1"],
      ["Post", "4"],
      ["Length (mm)", l],
      ["Width (mm)", w],
      ["Height (mm)", heightMm],
      ["Frame colour", "TBC"],
      ["Louver colour", "TBC"],
      ["Operation", operation],
      ["Louver LED", ledLouver || "—"],
      ["Gutter LED", ledGutter || "—"],
      ["1 Unit price", money(unit)],
      ["1×40HQ price", money(cont)],
    ]),
  }));

  const cheapest = Math.min(...variants.map((v) => v.price));

  return {
    name,
    sourceHandle: handle,
    categorySlug,
    doc: {
      description:
        `Bioclimatic aluminium louvered pergola from AlunoTec's ${series} range. ` +
        `The roof blades rotate to control sun and ventilation and close to shed ` +
        `rainwater through the beam gutter and down inside the posts. Built in ` +
        `6063-T6 aluminium with a ${profile.blade} blade, a ${profile.beam} main ` +
        `beam and gutter, and ${profile.post} posts, finished in AkzoNobel powder ` +
        `coating. Supplied freestanding on four posts at ${heightMm} mm high. ` +
        `Choose your plan size below.\n` +
        features.map((f) => `${f}`).join("\n"),
      shortDescription:
        `${series} ${modelNumber} louvered pergola, ${operation.toLowerCase()}, ` +
        `${rows.length} standard plan sizes.`,
      price: cheapest,
      stock: 25,
      images,
      brandField: true,
      department: DEPARTMENT,
      specs: {
        Series: series,
        "Model number": modelNumber,
        Material: "6063-T6 aluminium alloy",
        "Blade profile": profile.blade,
        "Main beam & gutter": profile.beam,
        "Post profile": profile.post,
        "Standard height": `${heightMm} mm`,
        "Design type": "FS (freestanding)",
        Bays: "1",
        Posts: "4",
        Operation: operation,
        "Louver LED": ledLouver || "Not fitted",
        "Gutter LED": ledGutter || "Not fitted",
        Coating: "AkzoNobel powder coating",
        "Frame colour": "TBC",
        "Louver colour": "TBC",
        sizeWeightTable: {
          caption: `${source} — every priced row`,
          headings: [
            "Nr",
            "Size L × W (mm)",
            "H (mm)",
            "Bay",
            "Post",
            "Operation",
            "Louver LED",
            "Gutter LED",
            "1 Unit (US$)",
            "1×40HQ (US$)",
          ],
          rows: rows.map(([nr, l, w, unit, cont]) => [
            String(nr),
            `${l} × ${w}`,
            String(heightMm),
            "1",
            "4",
            operation,
            ledLouver || "/",
            ledGutter || "/",
            money(unit),
            money(cont),
          ]),
        },
      },
      showSpecs: true,
      // Fabricated to the size the customer picks and quoted per unit. Outdoor
      // Living otherwise hands the PDP its per-m² calculator, which would
      // price a pergola like decking.
      soldPerUnit: true,
      shopifyOptions: [
        { name: "Size", position: 1, values: variants.map((v) => v.option1) },
      ],
      variants,
      manuals: manualsFor(modelNumber),
      warrantyFiles: WARRANTY_FILES,
      productSections: sections(),
    },
  };
}

// -------------------------------------------------------------- blinds/doors
function buildBlind({ handle, name, categorySlugs, profile, modelNumber, rows, operation, features, images, source }) {
  const variants = rows.map(([nr, side, w, h, unit, cont], i) => ({
    name: side,
    sku: `${modelNumber}-${side.replace(/\s+/g, "")}`,
    option1: side,
    price: sellPrice(unit, cont),
    containerPrice: cont,
    stock: 25,
    position: i + 1,
    isDefault: i === 0,
    externalId: `${source}#${nr}`,
    dimensionsMm: { lengthMm: null, widthMm: w, heightMm: h },
    attributes: attrs([
      ["Quotation row", `Nr. ${nr}`],
      ["Series", "Zipped Blind"],
      ["Model number", modelNumber],
      ["Design type", "FS (freestanding)"],
      ["Bay side", side],
      ["Width (mm)", w],
      ["Height (mm)", h],
      ["Frame colour", "TBC"],
      ["Fabric colour", "TBC"],
      ["Operation", operation],
      ["1 Unit price", money(unit)],
      ["1×40HQ price", money(cont)],
    ]),
  }));

  return {
    name,
    sourceHandle: handle,
    categorySlugs,
    doc: {
      description:
        `Zip-tensioned side blind for the Palora pergola, model ${modelNumber}. ` +
        `A polyester fabric screen runs in aluminium side channels so it stays ` +
        `taut and will not billow, closing a bay against low sun and wind. ` +
        `${operation} operation. One blind covers one bay side — order one per ` +
        `side you want enclosed.\n` +
        features.join("\n"),
      shortDescription: `${operation} zip-tensioned pergola side blind, ${rows.length} bay widths.`,
      price: Math.min(...variants.map((v) => v.price)),
      stock: 25,
      images,
      department: DEPARTMENT,
      specs: {
        Series: "Zipped Blind",
        "Model number": modelNumber,
        Material: "Aluminium alloy frame, polyester fabric",
        Operation: operation,
        "Design type": "FS (freestanding)",
        "Frame colour": "TBC",
        "Fabric colour": "TBC",
        sizeWeightTable: {
          caption: `${source} — every priced row`,
          headings: [
            "Nr",
            "Bay side",
            "W (mm)",
            "H (mm)",
            "Operation",
            "1 Unit (US$)",
            "1×40HQ (US$)",
          ],
          rows: rows.map(([nr, side, w, h, unit, cont]) => [
            String(nr),
            side,
            String(w),
            String(h),
            operation,
            money(unit),
            money(cont),
          ]),
        },
      },
      showSpecs: true,
      // Fabricated to the size the customer picks and quoted per unit. Outdoor
      // Living otherwise hands the PDP its per-m² calculator, which would
      // price a pergola like decking.
      soldPerUnit: true,
      shopifyOptions: [
        { name: "Bay side", position: 1, values: variants.map((v) => v.option1) },
      ],
      variants,
      manuals: manualsFor(profile),
      warrantyFiles: WARRANTY_FILES,
      productSections: sections(),
    },
  };
}

function buildDoor({ handle, name, categorySlugs, profile, rows, frameColour, features, images, source }) {
  const variants = rows.map(([nr, side, w, h, tracks, panels, unit], i) => ({
    // Rows 14 and 15 of the P6 quotation print the same size and the same
    // track/panel count at two different prices, so the label alone would not
    // tell them apart. The quotation row number does.
    name: `${side} · ${tracks} tracks / ${panels} panels (Nr. ${nr})`,
    sku: `SLIDF610-${side.replace(/\s+/g, "")}-${panels}P-${nr}`,
    option1: `${side} · ${tracks} tracks / ${panels} panels (Nr. ${nr})`,
    price: unit,
    containerPrice: null,
    stock: 25,
    position: i + 1,
    isDefault: i === 0,
    externalId: `${source}#${nr}`,
    dimensionsMm: { lengthMm: null, widthMm: w, heightMm: h },
    attributes: attrs([
      ["Quotation row", `Nr. ${nr}`],
      ["Series", "Frameless Sliding Door"],
      ["Model number", "SlidF610"],
      ["Bay side", side],
      ["Tracks", tracks],
      ["Panels", panels],
      ["Width (mm)", w],
      ["Height (mm)", h],
      ["Frame colour", frameColour],
      ["Glass", "Transparent, 10mm tempered"],
      ["Operation", "Sliding"],
      ["1 Unit price", money(unit)],
      ["1×40HQ price", "—"],
    ]),
  }));

  return {
    name,
    sourceHandle: handle,
    categorySlugs,
    doc: {
      description:
        `Frameless sliding glass door for the Palora pergola, model SlidF610. ` +
        `10mm tempered glass panels slide on an aluminium track to close a bay ` +
        `into a usable room, with no vertical frame between panels so the view ` +
        `stays open. Supplied per bay side.\n` +
        features.join("\n"),
      shortDescription: `Frameless 10mm tempered glass sliding door, ${rows.length} bay configurations.`,
      price: Math.min(...variants.map((v) => v.price)),
      stock: 25,
      images,
      department: DEPARTMENT,
      specs: {
        Series: "Frameless Sliding Door",
        "Model number": "SlidF610",
        Material: "Aluminium alloy",
        Glass: "10 mm tempered, transparent",
        "Glass warranty": "2 years",
        Operation: "Sliding",
        "Frame colour": frameColour,
        sizeWeightTable: {
          caption: `${source} — every priced row`,
          headings: [
            "Nr",
            "Bay side",
            "Tracks",
            "Panels",
            "W (mm)",
            "H (mm)",
            "Frame",
            "1 Unit (US$)",
          ],
          rows: rows.map(([nr, side, w, h, tracks, panels, unit]) => [
            String(nr),
            side,
            String(tracks),
            String(panels),
            String(w),
            String(h),
            frameColour,
            money(unit),
          ]),
        },
      },
      showSpecs: true,
      // Fabricated to the size the customer picks and quoted per unit. Outdoor
      // Living otherwise hands the PDP its per-m² calculator, which would
      // price a pergola like decking.
      soldPerUnit: true,
      shopifyOptions: [
        { name: "Configuration", position: 1, values: variants.map((v) => v.option1) },
      ],
      variants,
      manuals: manualsFor(profile),
      warrantyFiles: WARRANTY_FILES,
      productSections: sections(),
    },
  };
}

// ------------------------------------------------------------------ products
const P6_PROFILE = {
  blade: "180 × 45 × 1.7 mm",
  beam: "190 × 115 × 2.2 mm",
  post: "150 × 150 × 2.0 mm",
};
const P4_PROFILE = {
  blade: "153 × 40 × 1.2 mm",
  beam: "173 × 95 × 2.0 mm",
  post: "122 × 122 × 1.6 mm",
};

const PRODUCTS = [
  buildPergola({
    handle: "alunotec-palora-p6-motorized-pergola",
    name: "AlunoTec Palora P6 Motorized Louvered Pergola",
    categorySlug: "motorized-palora-p6",
    modelNumber: "P6",
    series: "Pergo-Eco",
    rows: P6_MOTORIZED_ROWS,
    heightMm: 2490,
    operation: "Motorized 220V",
    ledLouver: "6000K (dimmable)",
    ledGutter: "RGB",
    profile: P6_PROFILE,
    features: [
      "Dimmable louver LED plus RGB gutter lighting.",
      "Phone app control.",
      "5 years motor warranty.",
      "AkzoNobel powder coating.",
    ],
    images: [
      img("palora-p6-4x6-motorized-wall-mounted-with-blade-and-gutter-lighting-1.jpg"),
      img("palora-p6-4x6-motorized-freestanding-with-blade-and-gutter-lighting-2.jpg"),
      img("palora-p6-4x6-motorized-wall-mounted-with-blade-and-gutter-lighting-4.jpg"),
      img("palora-p6-4x6-motorized-freestanding-with-blade-and-gutter-lighting-6.jpg"),
      img("palora-p6-4x6-motorized-freestanding-with-zipped-and-blade-and-gutter-lighting-5.jpg"),
      img("p6-motorized-02.jpg"),
    ],
    source: "260731 Motorized Palora P6 Price List",
  }),
  buildPergola({
    handle: "alunotec-palora-p6-manual-pergola",
    name: "AlunoTec Palora P6 Manual Louvered Pergola",
    categorySlug: "manual-palora-p6",
    modelNumber: "P6",
    series: "Pergo-Eco",
    rows: P6_MANUAL_ROWS,
    heightMm: 2490,
    operation: "Motorized 110V",
    ledLouver: "",
    ledGutter: "",
    profile: P6_PROFILE,
    features: ["AkzoNobel powder coating."],
    images: [
      img("palora-p6-4x6-manual-wall-mounted-8.jpg"),
      img("palora-p6-4x6-manual-wall-mounted-9.jpg"),
      img("palora-p6-4x6-freestanding-mounted-10.jpg"),
      img("palora-p6-4x6-freestanding-mounted-11.jpg"),
      img("palora-p6-4x6-manual-wall-mounted-with-zipped-blind-7.jpg"),
      img("p6-motorized-02.jpg"),
    ],
    source: "260731 Manual Palora P6 Price List",
  }),
  buildPergola({
    handle: "alunotec-palora-p4-motorized-pergola",
    name: "AlunoTec Palora P4 Motorized Louvered Pergola",
    categorySlug: "motorized-palora-p4",
    modelNumber: "P4",
    series: "Pergo-Lite",
    rows: P4_MOTORIZED_ROWS,
    heightMm: 2475,
    operation: "Motorized 110V",
    ledLouver: "6000K (dimmable)",
    ledGutter: "6000K",
    profile: P4_PROFILE,
    features: [
      "Dimmable louver LED plus gutter lighting.",
      "Phone app control.",
      "5 years motor warranty.",
      "AkzoNobel powder coating.",
    ],
    images: [
      img("p4-motorized-02.jpg"),
      img("p4-motorized-03.jpg"),
      img("p4-motorized-04.jpg"),
    ],
    source: "260731 Motorized Palora P4 Price List",
  }),
  buildPergola({
    handle: "alunotec-palora-p4-manual-pergola",
    name: "AlunoTec Palora P4 Manual Louvered Pergola",
    categorySlug: "manual-palora-p4",
    modelNumber: "P4",
    series: "Pergo-Lite",
    rows: P4_MANUAL_ROWS,
    heightMm: 2475,
    operation: "Motorized 110V",
    ledLouver: "6000K",
    ledGutter: "6000K",
    profile: P4_PROFILE,
    features: ["AkzoNobel powder coating."],
    images: [
      img("p4-motorized-02.jpg"),
      img("p4-motorized-03.jpg"),
      img("p4-motorized-04.jpg"),
    ],
    source: "260731 Manual Palora P4 Price List",
  }),

  buildBlind({
    handle: "alunotec-palora-p6-zipped-blind",
    name: "AlunoTec Palora P6 Motorized Zipped Blind",
    categorySlugs: ["motorized-palora-p6", "manual-palora-p6"],
    profile: "P6",
    modelNumber: "Zip71102E",
    rows: P6_BLIND_ROWS,
    operation: "Motorized 220V",
    features: ["Aluminium alloy.", "Polyester fabric.", "3 years motor warranty."],
    images: [
      img("p6-motorized-03.jpg"),
      img("p6-motorized-04.jpg"),
      img("palora-p6-4x6-motorized-wall-mounted-with-zipped-blind-and-blade-and-gutter-lighting-3.jpg"),
      img("palora-p6-4x6-manual-wall-mounted-with-zipped-blind-7.jpg"),
      img("palora-p6-4x6-motorized-freestanding-with-zipped-and-blade-and-gutter-lighting-5.jpg"),
    ],
    source: "260731 Palora P6 Price List",
  }),
  buildBlind({
    handle: "alunotec-palora-p4-zipped-blind",
    name: "AlunoTec Palora P4 Manual Zipped Blind",
    categorySlugs: ["motorized-palora-p4", "manual-palora-p4"],
    profile: "P4",
    modelNumber: "Zip-X100B",
    rows: P4_BLIND_ROWS,
    operation: "Manual",
    features: ["Aluminium alloy.", "Polyester fabric."],
    images: [img("p4-motorized-05.jpg")],
    source: "260731 Palora P4 Price List",
  }),

  buildDoor({
    handle: "alunotec-palora-p6-sliding-door",
    name: "AlunoTec Palora P6 Frameless Sliding Glass Door",
    categorySlugs: ["motorized-palora-p6", "manual-palora-p6"],
    profile: "P6",
    rows: P6_DOOR_ROWS,
    frameColour: "TBC",
    features: ["Aluminium alloy.", "10mm tempered glass.", "Glass warranty: 2 years."],
    images: [
      img("palora-p6-4x10-sliding-glass-door-1.jpg"),
      img("palora-p6-4x10-sliding-glass-door-2.jpg"),
      img("palora-p6-4x10-sliding-glass-door-3.jpg"),
      img("palora-p6-4x10-sliding-glass-door-4.jpg"),
      img("palora-p6-4x10-sliding-glass-door-5.jpg"),
      img("palora-p6-4x10-sliding-glass-door-6.jpg"),
      img("p6-motorized-05.jpg"),
      img("p6-motorized-06.jpg"),
      img("p6-motorized-07.jpg"),
    ],
    source: "260731 Palora P6 Price List",
  }),
  buildDoor({
    handle: "alunotec-palora-p4-sliding-door",
    name: "AlunoTec Palora P4 Frameless Sliding Glass Door",
    categorySlugs: ["motorized-palora-p4", "manual-palora-p4"],
    profile: "P4",
    rows: P4_DOOR_ROWS,
    frameColour: "Old Grey",
    features: ["Aluminium alloy.", "10mm tempered glass."],
    images: [img("p4-motorized-06.jpg"), img("p4-motorized-07.jpg")],
    source: "260731 Palora P4 Price List",
  }),
];

// ---------------------------------------------------------------------- main
async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brands = db.collection("brands");
  const menus = db.collection("menus");
  const products = db.collection("products");

  if (ROLLBACK) {
    const plan = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const id of plan.insertedProductIds || []) {
      await products.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    }
    for (const id of plan.insertedMenuIds || []) {
      await menus.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    }
    if (plan.insertedBrandId) {
      await brands.deleteOne({ _id: new mongoose.Types.ObjectId(plan.insertedBrandId) });
    }
    console.log(
      `Rolled back ${(plan.insertedProductIds || []).length} product(s), ` +
        `${(plan.insertedMenuIds || []).length} menu(s)` +
        (plan.insertedBrandId ? " and the AlunoTec brand" : ""),
    );
    await mongoose.disconnect();
    return;
  }

  // A 404 behind a Warranty tab is worse than no tab at all, so every
  // document the products link to must be on disk before anything is written.
  for (const f of [AWNING_CATALOGUE, P6_CATALOGUE, ...WARRANTY_FILES]) {
    const onDisk = path.join(__dirname, "..", "public", decodeURI(f.url).replace(/^\//, ""));
    if (!fs.existsSync(onDisk)) throw new Error(`Missing document: ${onDisk}`);
  }

  const rollback = { insertedBrandId: null, insertedMenuIds: [], insertedProductIds: [] };

  // ---- brand ---------------------------------------------------------
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  if (brand) {
    // Keep the storefront label in step on a re-run, not just on first import.
    const needsUiName = brand.uiName !== BRAND_UI_NAME;
    if (needsUiName && APPLY) {
      await brands.updateOne(
        { _id: brand._id },
        { $set: { uiName: BRAND_UI_NAME, updatedAt: new Date() } },
      );
    }
    console.log(
      `brand  EXISTS  ${BRAND_SLUG} (${brand._id})` +
        (needsUiName
          ? `  ${APPLY ? "SET" : "WOULD SET"} uiName="${BRAND_UI_NAME}"`
          : ""),
    );
  } else if (APPLY) {
    const maxOrder = await brands
      .find({}, { projection: { order: 1 } })
      .sort({ order: -1 })
      .limit(1)
      .toArray();
    const res = await brands.insertOne({
      name: BRAND_NAME,
      uiName: BRAND_UI_NAME,
      slug: BRAND_SLUG,
      order: (maxOrder[0]?.order || 0) + 1,
      isActive: true,
      image: "",
      supplier: null,
      subBrands: [],
      shopifyCollectionId: null,
      shopifySyncError: null,
      shopifySyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rollback.insertedBrandId = String(res.insertedId);
    brand = { _id: res.insertedId };
    console.log(`brand  CREATE  ${BRAND_SLUG} (${res.insertedId})`);
  } else {
    console.log(`brand  WOULD CREATE  ${BRAND_SLUG} "${BRAND_NAME}"`);
    brand = { _id: null };
  }

  // ---- categories ----------------------------------------------------
  let order = 0;
  const maxOrder = await menus
    .find({ parent: null }, { projection: { order: 1 } })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  order = maxOrder[0]?.order || 0;

  for (const cat of CATEGORIES) {
    const existing = await menus.findOne({ slug: cat.slug });
    if (existing) {
      console.log(`menu   EXISTS  ${cat.slug} (${existing._id})`);
      continue;
    }
    if (!APPLY) {
      console.log(`menu   WOULD CREATE  ${cat.slug} "${cat.name}"`);
      continue;
    }
    order += 1;
    const res = await menus.insertOne({
      name: cat.name,
      slug: cat.slug,
      parent: null,
      order,
      group: "",
      url: "",
      isActive: true,
      image: "",
      brand: brand._id,
      subBrand: "",
      subBrands: [],
      department: new mongoose.Types.ObjectId(DEPARTMENT_ID),
      level: "category",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rollback.insertedMenuIds.push(String(res.insertedId));
    console.log(`menu   CREATE  ${cat.slug} (${res.insertedId})`);
  }

  // ---- products ------------------------------------------------------
  let created = 0;
  let updated = 0;
  let variantCount = 0;

  for (const entry of PRODUCTS) {
    const cats = entry.categorySlugs || [entry.categorySlug];
    const doc = {
      ...entry.doc,
      name: entry.name,
      sourceHandle: entry.sourceHandle,
      brand: brand._id,
      category: cats[0],
      categories: cats,
      subCategory: "",
      subCategories: [],
    };
    delete doc.brandField;
    variantCount += doc.variants.length;

    const existing = await products.findOne({ sourceHandle: entry.sourceHandle });
    if (existing) {
      if (APPLY) {
        await products.updateOne(
          { _id: existing._id },
          { $set: { ...doc, updatedAt: new Date() } },
        );
      }
      updated++;
      console.log(
        `${APPLY ? "UPDATE" : "WOULD UPDATE"}  ${entry.name}  ` +
          `${doc.variants.length} variants  from US$${doc.price}  [${cats.join(", ")}]`,
      );
    } else {
      if (APPLY) {
        const res = await products.insertOne({
          ...doc,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rollback.insertedProductIds.push(String(res.insertedId));
      }
      created++;
      console.log(
        `${APPLY ? "CREATE" : "WOULD CREATE"}  ${entry.name}  ` +
          `${doc.variants.length} variants  from US$${doc.price}  [${cats.join(", ")}]`,
      );
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${created} created, ${updated} updated, ` +
      `${variantCount} priced variants across ${PRODUCTS.length} products ` +
      `in ${CATEGORIES.length} categories.`,
  );

  if (
    APPLY &&
    (rollback.insertedProductIds.length ||
      rollback.insertedMenuIds.length ||
      rollback.insertedBrandId)
  ) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-alunotec-palora-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written to ${path.basename(file)}`);
  }
  if (!APPLY) console.log("Re-run with --apply to write.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
