import mongoose from "mongoose";

const OptionExtraSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    priceAdjustment: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const FlashingFinderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
  },
  { _id: false },
);

const ProductVariantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: "", trim: true },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
    price: { type: Number, default: null },
    tradePrice: { type: Number, default: null },
    stock: { type: Number, default: null },
    imageUrl: { type: String, default: "" },
    barcode: { type: String, default: "", trim: true },
    isDefault: { type: Boolean, default: false },
    /** Supplier option axis values (e.g. Wattage / Coverage / Colour). */
    option1: { type: String, default: "", trim: true },
    option2: { type: String, default: "", trim: true },
    option3: { type: String, default: "", trim: true },
    available: { type: Boolean, default: true },
    /** Was-price / RRP for this variant. */
    compareAtPrice: { type: Number, default: null },
    /** Merchandising label shown on the variant (e.g. "OUR PICK"). */
    badge: { type: String, default: "", trim: true },
    /** Supplier variant id, kept so re-scrapes can match rows. */
    externalId: { type: String, default: "", trim: true },
    weight: { type: Number, default: null },
    position: { type: Number, default: 0 },
    /** Quantity price breaks: [{ minimumQuantity, price }] */
    quantityPriceBreaks: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  { _id: true },
);

const ProductDownloadChildSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ProductDownloadSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    /** Primary file URL (optional when children are present). */
    url: { type: String, default: "", trim: true },
    type: {
      type: String,
      enum: ["pdf", "drawing", "install", "certificate", "other"],
      default: "pdf",
    },
    /** Optional Noken-style icon. */
    iconUrl: { type: String, default: "", trim: true },
    /** Nested files (e.g. 2D / 3D file groups). */
    children: { type: [ProductDownloadChildSchema], default: [] },
  },
  { _id: false },
);

/** Porcelanosa-style Files and Documentation (headed groups). */
const FilesDocumentationFileSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["pdf", "zip", "other"],
      default: "pdf",
    },
  },
  { _id: false },
);

const FilesDocumentationSectionSchema = new mongoose.Schema(
  {
    heading: { type: String, required: true, trim: true },
    files: { type: [FilesDocumentationFileSchema], default: [] },
  },
  { _id: false },
);

/** Porcelanosa-style Features / Packing rows (label → value). */
const KeyValueEntrySchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/** Optional colour variants (name + swatch + product image). */
const ColorOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    swatchType: {
      type: String,
      enum: ["solid", "gradient", "image"],
      default: "solid",
    },
    colorValue: { type: String, default: "", trim: true },
    swatchImage: { type: String, default: "", trim: true },
    imageUrl: { type: String, default: "", trim: true },
    sap: { type: String, default: "", trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Optional size variants (name + optional image). */
const SizeOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: "", trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Named file link (brochure / installer guide). */
const NamedFileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/** "More info" copy attached to an option axis (rendered behind the ⓘ). */
const OptionInfoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Rich copy as shown on the supplier PDP tooltip. */
    html: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** One row of a supplier dimensions / specification table. */
const SpecRowSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, default: "", trim: true },
    /** Original supplier key, e.g. "dimensions.max_width". */
    key: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** Aggregate star rating carried over from the supplier's review platform. */
const ReviewSummarySchema = new mongoose.Schema(
  {
    rating: { type: Number, default: null },
    count: { type: Number, default: 0 },
    /** e.g. "reviews.io" */
    source: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** Promo banner strip above the buy box. */
const PromoBannerSchema = new mongoose.Schema(
  {
    image: { type: String, default: "", trim: true },
    url: { type: String, default: "", trim: true },
    alt: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** Britmet Product Range row: name + image + optional custom table. */
const ProductRangeItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    image: { type: String, default: "", trim: true },
    tableHeadings: { type: [String], default: [] },
    tableRows: { type: [[String]], default: [] },
  },
  { _id: false },
);

const CaseStudyItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    coverImage: { type: String, default: "", trim: true },
    file: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const GeneralSpecificationSchema = new mongoose.Schema(
  {
    image: { type: String, default: "", trim: true },
    content: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** Suitability — either table or image (mutually exclusive). */
const SuitabilitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["", "table", "image"],
      default: "",
    },
    image: { type: String, default: "", trim: true },
    tableHeadings: { type: [String], default: [] },
    tableRows: { type: [[String]], default: [] },
  },
  { _id: false },
);

/** Otto-style Usage / Explore item (icon image + optional tick). */
const UsageItemSchema = new mongoose.Schema(
  {
    title: { type: String, default: "", trim: true },
    image: { type: String, default: "", trim: true },
    checked: { type: Boolean, default: true },
  },
  { _id: false },
);

/** Pooky-style Base / Shade option (name, images, price, stock). */
const PookyOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    images: { type: [String], default: [] },
    price: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    handle: { type: String, default: "", trim: true },
    sku: { type: String, default: "", trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Pooky efficiency tab. */
const PookyEfficiencySchema = new mongoose.Schema(
  {
    summary: { type: String, default: "", trim: true },
    details: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const DrawingEntrySchema = new mongoose.Schema(
  {
    ref: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    files: { type: [NamedFileSchema], default: [] },
  },
  { _id: false },
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    /** Short / summary copy (e.g. WooCommerce short_description). */
    shortDescription: { type: String, default: "", trim: true },
    price: { type: Number, required: true },
    /** Trade / account price (ex VAT) when applicable */
    tradePrice: { type: Number, default: null },
    images: [{ type: String }],
    videos: [{ type: String }],
    /** Supplier stock message (e.g. "124 in stock (can be backordered)"). */
    stockAvailabilityText: { type: String, default: "", trim: true },

    /**
     * LINX taxonomy:
     * Department → Category → Subcategory → Product (+ variants)
     * Brand is independent and may be multi-valued.
     */
    department: { type: String, default: "", trim: true, index: true },
    /** Empty = not ready for storefront / Shopify stays Draft */
    category: { type: String, default: "", trim: true },
    subCategory: { type: String },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    /** Optional slug from Brand.subBrands[] for the selected brand */
    subBrand: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    /** Additional brands this product appears under (Shop by Brand) */
    brands: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Brand" }],
      default: [],
    },

    /** Override brand default supplier when set */
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    /** Our internal SKU (LINX Product ID) — falls back to specs.sku when empty */
    linxSku: { type: String, default: "", trim: true, index: true },
    supplierSku: { type: String, default: "", trim: true },
    manufacturerSku: { type: String, default: "", trim: true },
    productCode: { type: String, default: "", trim: true, index: true },
    barcode: { type: String, default: "", trim: true },

    /** Ex-VAT cost from supplier */
    costPrice: { type: Number, default: null },
    importCost: { type: Number, default: null },
    deliveryCost: { type: Number, default: null },
    dutyCost: { type: Number, default: null },
    packagingCost: { type: Number, default: null },
    handlingCost: { type: Number, default: null },
    overheadCost: { type: Number, default: null },
    /** Margin % applied on landed cost to set sell price (ex VAT) */
    marginPercent: { type: Number, default: null },
    /** VAT rate % — UK standard 20 */
    vatRate: { type: Number, default: 20 },
    leadTimeDays: { type: Number, default: null },
    deliveryEstimateDays: { type: Number, default: null },
    warranty: { type: String, default: "", trim: true },
    complianceCertificates: { type: [String], default: [] },
    stock: { type: Number, required: true, default: 0 },
    stockSyncedAt: { type: Date, default: null },
    priceSyncedAt: { type: Date, default: null },
    /** Out-of-stock flag for sync jobs */
    isOutOfStock: { type: Boolean, default: false },
    stockStatus: {
      type: String,
      enum: ["in_stock", "low_stock", "out_of_stock", "made_to_order", "preorder"],
      default: "in_stock",
    },

    tagline: { type: String },
    features: { type: [String], default: [] },
    /** Optional key/value Features block (Porcelanosa-style). */
    featureEntries: { type: [KeyValueEntrySchema], default: [] },
    /** Optional key/value Packing block (Porcelanosa-style). */
    packingEntries: { type: [KeyValueEntrySchema], default: [] },
    /** Optional legal disclaimer text (Porcelanosa Product Finder). */
    legalDisclaimer: { type: String, default: "", trim: true },
    colours: { type: [String], default: [] },
    /** Optional selectable colour variants with swatch + product image. */
    colorOptions: { type: [ColorOptionSchema], default: [] },
    /** Optional selectable size variants with name + image. */
    sizeOptions: { type: [SizeOptionSchema], default: [] },
    materials: { type: [String], default: [] },
    finish: { type: String, default: "", trim: true },
    dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
    keywords: { type: [String], default: [] },
    synonyms: { type: [String], default: [] },

    schematicImage: { type: String },
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    showSpecs: { type: Boolean, default: true },
    variants: { type: [ProductVariantSchema], default: [] },
    downloads: { type: [ProductDownloadSchema], default: [] },
    /**
     * Porcelanosa Product Finder “Files and Documentation” —
     * separate from Noken-style `downloads`.
     */
    filesDocumentation: {
      type: [FilesDocumentationSectionSchema],
      default: [],
    },
    technicalDrawings: { type: [String], default: [] },
    /** Britmet-style Brochure tab (name + file). */
    brochures: { type: [NamedFileSchema], default: [] },
    /** Britmet-style Product Range (name, image, optional table). */
    productRange: { type: [ProductRangeItemSchema], default: [] },
    /** Britmet-style Case Studies (cover, name, file). */
    caseStudies: { type: [CaseStudyItemSchema], default: [] },
    /** Britmet-style General Specification (text + optional image). */
    generalSpecification: {
      type: GeneralSpecificationSchema,
      default: () => ({ image: "", content: "" }),
    },
    /** Britmet-style Installer Guide (name + files). */
    installerGuides: { type: [NamedFileSchema], default: [] },
    /** Britmet-style Technical Drawings (Ref, Description, Files). */
    drawingEntries: { type: [DrawingEntrySchema], default: [] },
    /** Room / product Suitability — table OR image. */
    suitability: {
      type: SuitabilitySchema,
      default: () => ({
        type: "",
        image: "",
        tableHeadings: [],
        tableRows: [],
      }),
    },
    /** Otto Tiles–style accordion copy shown under Product Description. */
    delivery: { type: String, default: "", trim: true },
    howItsMade: { type: String, default: "", trim: true },
    productAndSampleOrders: { type: String, default: "", trim: true },
    /**
     * Download Installation & Maintenance Guides —
     * separate from `downloads` and `filesDocumentation`.
     */
    installationMaintenanceGuides: {
      type: [NamedFileSchema],
      default: [],
    },
    /** Otto-style Usage icons; also powers the Explore section on the PDP. */
    usage: { type: [UsageItemSchema], default: [] },
    /** Pooky-style lamp bases (name, images, price, stock). */
    bases: { type: [PookyOptionSchema], default: [] },
    /** Pooky-style lamp shades (name, images, price, stock). */
    shades: { type: [PookyOptionSchema], default: [] },
    /** Pooky pendant shades. */
    pendants: { type: [PookyOptionSchema], default: [] },
    /** Pooky wall fittings. */
    wallFittings: { type: [PookyOptionSchema], default: [] },
    /**
     * Supplier dimensions / specification rows (height, material, wattage,
     * bulb type, IP rating …) in the order the supplier lists them.
     * Separate from the free-form `dimensions` map used by other brands.
     */
    dimensionRows: { type: [SpecRowSchema], default: [] },
    /** Supplier star rating shown next to the title. */
    reviewSummary: {
      type: ReviewSummarySchema,
      default: () => ({ rating: null, count: 0, source: "" }),
    },
    /** Faceted attributes (colour, style, fitting type, location …). */
    attributes: { type: [SpecRowSchema], default: [] },
    /** Second gallery image revealed on hover. */
    hoverImage: { type: String, default: "", trim: true },
    /** Lights-on / lights-off gallery pair. */
    lightModeImage: { type: String, default: "", trim: true },
    darkModeImage: { type: String, default: "", trim: true },
    hasDarkModeToggle: { type: Boolean, default: false },
    /** Units sold, shown as social proof by the supplier. */
    soldCount: { type: Number, default: null },
    /** Supplier handles for upsell ("goes with") and related products. */
    upsellHandles: { type: [String], default: [] },
    relatedHandles: { type: [String], default: [] },
    /** Pooky efficiency details tab. */
    efficiency: {
      type: PookyEfficiencySchema,
      default: () => ({ summary: "", details: "" }),
    },

    /**
     * Underfloor Heating Store–style sections.
     * Coverage picker, nested Globo-style options, Do the Job Right tools.
     */
    coverage: {
      type: new mongoose.Schema(
        {
          label: { type: String, default: "Coverage", trim: true },
          helptext: { type: String, default: "", trim: true },
          values: {
            type: [
              {
                name: { type: String, required: true, trim: true },
                imageUrl: { type: String, default: "", trim: true },
                priceAdjustment: { type: Number, default: 0 },
                sku: { type: String, default: "", trim: true },
                sortOrder: { type: Number, default: 0 },
              },
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: () => ({ label: "Coverage", helptext: "", values: [] }),
    },
    /** Nested product options (image swatches and/or text), recursively nestable. */
    nestedOptions: { type: mongoose.Schema.Types.Mixed, default: [] },
    /**
     * Supplier option builder, flattened in render order: swatches, buttons,
     * dropdowns, heading/description paragraphs, pre-selected defaults and the
     * show/hide rules that drive the configurator flow.
     */
    optionElements: { type: mongoose.Schema.Types.Mixed, default: [] },
    /**
     * Supplier add-on form (e.g. the m² calculator and option groups on a
     * WooCommerce PDP), captured in render order with its conditions.
     */
    addonGroups: { type: mongoose.Schema.Types.Mixed, default: [] },
    doTheJobRight: {
      type: new mongoose.Schema(
        {
          label: { type: String, default: "", trim: true },
          helptext: { type: String, default: "", trim: true },
          items: {
            type: [
              {
                name: { type: String, required: true, trim: true },
                imageUrl: { type: String, default: "", trim: true },
                priceAdjustment: { type: Number, default: 0 },
                description: { type: String, default: "", trim: true },
                sortOrder: { type: Number, default: 0 },
              },
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: () => ({
        label: "Do the Job Right - Tools and Testing Equipment",
        helptext: "",
        items: [],
      }),
    },
    /** Native Shopify option axes (e.g. Wattage + Coverage). */
    shopifyOptions: { type: mongoose.Schema.Types.Mixed, default: [] },
    /**
     * Per-axis "more info" copy shown behind the ⓘ next to an option label
     * (e.g. what 100W / 150W / 200W each suit).
     */
    optionInfo: { type: [OptionInfoSchema], default: [] },
    /** Manuals / installation guides listed in the PDP "Manuals" section. */
    manuals: { type: [NamedFileSchema], default: [] },
    /** Merchandising labels shown on the product (e.g. "OUR PICK"). */
    badges: { type: [String], default: [] },
    /** Promo banner shown above the buy box. */
    promoBanner: {
      type: PromoBannerSchema,
      default: () => ({ image: "", url: "", alt: "" }),
    },

    relatedProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    accessoryProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    sparePartProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },

    /** Linx Glass–style optional content / add-ons */
    installationGuide: { type: String, default: null },
    /** null = not offered on PDP */
    insulatingSetPrice: { type: Number, default: null },
    flashingFinder: { type: [FlashingFinderSchema], default: [] },
    finishes: { type: [OptionExtraSchema], default: [] },
    flashings: { type: [OptionExtraSchema], default: [] },

    /**
     * Plankhardware-style flexible sections.
     * These are optional blocks rendered on the PDP when populated.
     */
    materialAndCare: {
      type: new mongoose.Schema(
        {
          html: { type: String, default: "", trim: true },
          images: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({ html: "", images: [] }),
    },
    responsibilityAndCompliance: {
      type: new mongoose.Schema(
        {
          html: { type: String, default: "", trim: true },
          images: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({ html: "", images: [] }),
    },
    maintenance: {
      type: new mongoose.Schema(
        {
          html: { type: String, default: "", trim: true },
          images: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({ html: "", images: [] }),
    },
    finishGuide: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true, trim: true },
            imageUrl: { type: String, default: "", trim: true },
            description: { type: String, default: "", trim: true },
            pairsWellWith: {
              type: new mongoose.Schema(
                {
                  description: { type: String, default: "", trim: true },
                  images: { type: [String], default: [] },
                },
                { _id: false },
              ),
              default: () => ({ description: "", images: [] }),
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    typeOptions: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true, trim: true },
            description: { type: String, default: "", trim: true },
            imageUrl: { type: String, default: "", trim: true },
            price: { type: Number, default: 0 },
            stock: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Shopify Admin GraphQL product GID (gid://shopify/Product/...) */
    shopifyProductId: { type: String, default: null, index: true },
    /** Shopify variant GID used for price/inventory/cart */
    shopifyVariantId: { type: String, default: null },
    /** Last Shopify sync error (null when healthy) */
    shopifySyncError: { type: String, default: null },
    shopifySyncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Covering indexes for the menu's department/category/subcategory counts —
// without these the aggregations are full collection scans.
ProductSchema.index({ department: 1, category: 1 });
ProductSchema.index({ department: 1, subCategory: 1 });
ProductSchema.index({ category: 1, createdAt: -1 });
ProductSchema.index({ subCategory: 1, createdAt: -1 });
ProductSchema.index({ department: 1, createdAt: -1 });
ProductSchema.index({ brand: 1, createdAt: -1 });
ProductSchema.index({ brands: 1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ tradePrice: 1 });
ProductSchema.index({ stockStatus: 1 });
ProductSchema.index({
  name: "text",
  description: "text",
  linxSku: "text",
  supplierSku: "text",
  productCode: "text",
  keywords: "text",
  synonyms: "text",
});

// Hot reload can keep an older compiled model without newer fields.
if (mongoose.models.Product && !mongoose.models.Product.schema.path("brand")) {
  mongoose.models.Product.schema.add({
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("subBrand")
) {
  mongoose.models.Product.schema.add({
    subBrand: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("shopifyProductId")
) {
  mongoose.models.Product.schema.add({
    shopifyProductId: { type: String, default: null, index: true },
    shopifyVariantId: { type: String, default: null },
    shopifySyncError: { type: String, default: null },
    shopifySyncedAt: { type: Date, default: null },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("installationGuide")
) {
  mongoose.models.Product.schema.add({
    installationGuide: { type: String, default: null },
    insulatingSetPrice: { type: Number, default: null },
    flashingFinder: { type: [FlashingFinderSchema], default: [] },
    finishes: { type: [OptionExtraSchema], default: [] },
    flashings: { type: [OptionExtraSchema], default: [] },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("materialAndCare")) {
  mongoose.models.Product.schema.add({
    materialAndCare: {
      type: new mongoose.Schema(
        {
          html: { type: String, default: "", trim: true },
          images: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({ html: "", images: [] }),
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("responsibilityAndCompliance")
) {
  mongoose.models.Product.schema.add({
    responsibilityAndCompliance: {
      type: new mongoose.Schema(
        {
          html: { type: String, default: "", trim: true },
          images: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({ html: "", images: [] }),
    },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("maintenance")) {
  mongoose.models.Product.schema.add({
    maintenance: {
      type: new mongoose.Schema(
        {
          html: { type: String, default: "", trim: true },
          images: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({ html: "", images: [] }),
    },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("finishGuide")) {
  mongoose.models.Product.schema.add({
    finishGuide: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true, trim: true },
            imageUrl: { type: String, default: "", trim: true },
            description: { type: String, default: "", trim: true },
            pairsWellWith: {
              type: new mongoose.Schema(
                {
                  description: { type: String, default: "", trim: true },
                  images: { type: [String], default: [] },
                },
                { _id: false },
              ),
              default: () => ({ description: "", images: [] }),
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("typeOptions")) {
  mongoose.models.Product.schema.add({
    typeOptions: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true, trim: true },
            description: { type: String, default: "", trim: true },
            imageUrl: { type: String, default: "", trim: true },
            price: { type: Number, default: 0 },
            stock: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("supplier")) {
  mongoose.models.Product.schema.add({
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
      index: true,
    },
    supplierSku: { type: String, default: "", trim: true },
    costPrice: { type: Number, default: null },
    marginPercent: { type: Number, default: null },
    leadTimeDays: { type: Number, default: null },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("linxSku")) {
  mongoose.models.Product.schema.add({
    linxSku: { type: String, default: "", trim: true, index: true },
    manufacturerSku: { type: String, default: "", trim: true },
    importCost: { type: Number, default: null },
    deliveryCost: { type: Number, default: null },
    dutyCost: { type: Number, default: null },
    packagingCost: { type: Number, default: null },
    handlingCost: { type: Number, default: null },
    overheadCost: { type: Number, default: null },
    vatRate: { type: Number, default: 20 },
    warranty: { type: String, default: "", trim: true },
    complianceCertificates: { type: [String], default: [] },
    stockSyncedAt: { type: Date, default: null },
    priceSyncedAt: { type: Date, default: null },
    isOutOfStock: { type: Boolean, default: false },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("department")) {
  mongoose.models.Product.schema.add({
    department: { type: String, default: "", trim: true, index: true },
    brands: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Brand" }],
      default: [],
    },
    tradePrice: { type: Number, default: null },
    videos: [{ type: String }],
    productCode: { type: String, default: "", trim: true, index: true },
    barcode: { type: String, default: "", trim: true },
    deliveryEstimateDays: { type: Number, default: null },
    stockStatus: {
      type: String,
      enum: ["in_stock", "low_stock", "out_of_stock", "made_to_order", "preorder"],
      default: "in_stock",
    },
    features: { type: [String], default: [] },
    colours: { type: [String], default: [] },
    materials: { type: [String], default: [] },
    finish: { type: String, default: "", trim: true },
    dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
    keywords: { type: [String], default: [] },
    synonyms: { type: [String], default: [] },
    variants: { type: [ProductVariantSchema], default: [] },
    downloads: { type: [ProductDownloadSchema], default: [] },
    technicalDrawings: { type: [String], default: [] },
    relatedProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    accessoryProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    sparePartProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
  });
}

if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("shortDescription")
) {
  mongoose.models.Product.schema.add({
    shortDescription: { type: String, default: "", trim: true },
    stockAvailabilityText: { type: String, default: "", trim: true },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("featureEntries")
) {
  mongoose.models.Product.schema.add({
    featureEntries: { type: [KeyValueEntrySchema], default: [] },
    packingEntries: { type: [KeyValueEntrySchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("legalDisclaimer")
) {
  mongoose.models.Product.schema.add({
    legalDisclaimer: { type: String, default: "", trim: true },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("colorOptions")
) {
  mongoose.models.Product.schema.add({
    colorOptions: { type: [ColorOptionSchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("sizeOptions")
) {
  mongoose.models.Product.schema.add({
    sizeOptions: { type: [SizeOptionSchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("filesDocumentation")
) {
  mongoose.models.Product.schema.add({
    filesDocumentation: {
      type: [FilesDocumentationSectionSchema],
      default: [],
    },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("brochures")) {
  mongoose.models.Product.schema.add({
    brochures: { type: [NamedFileSchema], default: [] },
    productRange: { type: [ProductRangeItemSchema], default: [] },
    caseStudies: { type: [CaseStudyItemSchema], default: [] },
    generalSpecification: {
      type: GeneralSpecificationSchema,
      default: () => ({ image: "", content: "" }),
    },
    installerGuides: { type: [NamedFileSchema], default: [] },
    drawingEntries: { type: [DrawingEntrySchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("suitability")
) {
  mongoose.models.Product.schema.add({
    suitability: {
      type: SuitabilitySchema,
      default: () => ({
        type: "",
        image: "",
        tableHeadings: [],
        tableRows: [],
      }),
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("delivery")
) {
  mongoose.models.Product.schema.add({
    delivery: { type: String, default: "", trim: true },
    howItsMade: { type: String, default: "", trim: true },
    productAndSampleOrders: { type: String, default: "", trim: true },
    installationMaintenanceGuides: {
      type: [NamedFileSchema],
      default: [],
    },
    usage: { type: [UsageItemSchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("bases")
) {
  mongoose.models.Product.schema.add({
    bases: { type: [PookyOptionSchema], default: [] },
    shades: { type: [PookyOptionSchema], default: [] },
    pendants: { type: [PookyOptionSchema], default: [] },
    wallFittings: { type: [PookyOptionSchema], default: [] },
    efficiency: {
      type: PookyEfficiencySchema,
      default: () => ({ summary: "", details: "" }),
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("pendants")
) {
  mongoose.models.Product.schema.add({
    pendants: { type: [PookyOptionSchema], default: [] },
    wallFittings: { type: [PookyOptionSchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("coverage")
) {
  mongoose.models.Product.schema.add({
    coverage: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ label: "Coverage", helptext: "", values: [] }),
    },
    nestedOptions: { type: mongoose.Schema.Types.Mixed, default: [] },
    doTheJobRight: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        label: "Do the Job Right - Tools and Testing Equipment",
        helptext: "",
        items: [],
      }),
    },
    shopifyOptions: { type: mongoose.Schema.Types.Mixed, default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("manuals")
) {
  mongoose.models.Product.schema.add({
    manuals: { type: [NamedFileSchema], default: [] },
    optionInfo: { type: [OptionInfoSchema], default: [] },
    badges: { type: [String], default: [] },
    promoBanner: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ image: "", url: "", alt: "" }),
    },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("optionElements")
) {
  mongoose.models.Product.schema.add({
    optionElements: { type: mongoose.Schema.Types.Mixed, default: [] },
    addonGroups: { type: mongoose.Schema.Types.Mixed, default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("dimensionRows")
) {
  mongoose.models.Product.schema.add({
    dimensionRows: { type: [SpecRowSchema], default: [] },
    attributes: { type: [SpecRowSchema], default: [] },
    reviewSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ rating: null, count: 0, source: "" }),
    },
    hoverImage: { type: String, default: "", trim: true },
    lightModeImage: { type: String, default: "", trim: true },
    darkModeImage: { type: String, default: "", trim: true },
    hasDarkModeToggle: { type: Boolean, default: false },
    soldCount: { type: Number, default: null },
    upsellHandles: { type: [String], default: [] },
    relatedHandles: { type: [String], default: [] },
  });
}

export const Product =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);
