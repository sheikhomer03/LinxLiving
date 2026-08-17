import mongoose from "mongoose";

/**
 * Stock level given to anything saved without one, at every level that carries
 * a stock figure — the product, its variants, and its option sub-documents.
 * Defaulting to 0 made a product out of stock the moment a form or an importer
 * omitted the field, which is never what is meant here.
 */
export const DEFAULT_STOCK = 1000;

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

/**
 * One column of a supplier quotation row, kept verbatim.
 *
 * A factory price list carries more per-row detail than the variant fields
 * below have names for — bay and post counts, frame and fabric colour, LED
 * colour temperature, track and panel counts. Rather than grow a field per
 * supplier, the columns we have no typed home for are kept here in the order
 * the price list prints them, so nothing is lost between the PDF and the PDP.
 */
const VariantAttributeSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** A supplier video hosted on YouTube / Vimeo, kept as an embed reference. */
const ExternalVideoSchema = new mongoose.Schema(
  {
    /** "vimeo" | "youtube". */
    host: { type: String, default: "", trim: true },
    /** The host's own video id. */
    externalId: { type: String, default: "", trim: true },
    /** Gallery src, in the bare `vimeo:<id>` / `youtube:<id>` form. */
    src: { type: String, required: true, trim: true },
    /** Supplier's preview still — Vimeo posters cannot be derived from the id. */
    posterUrl: { type: String, default: "", trim: true },
    /** Position the video held in the supplier's own gallery. */
    position: { type: Number, default: null },
    alt: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** Fabricated size in millimetres, as the supplier's dimension columns print it. */
const VariantDimensionsSchema = new mongoose.Schema(
  {
    lengthMm: { type: Number, default: null },
    widthMm: { type: Number, default: null },
    heightMm: { type: Number, default: null },
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
    stock: { type: Number, default: DEFAULT_STOCK },
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
    /**
     * This variant's own Shopify variant GID.
     *
     * Checkout is hosted by Shopify, and a Shopify cart line charges whatever
     * the variant costs — the price cannot be overridden. Without an id per
     * variant a customer choosing "900mm" would be charged the 700mm price, so
     * a variant that is not synced cannot be sold and must not silently fall
     * back to the product-level id.
     */
    shopifyVariantId: { type: String, default: "", trim: true },
    /** Shopify inventory item behind this variant, for stock pushes. */
    shopifyInventoryItemId: { type: String, default: "", trim: true },
    weight: { type: Number, default: null },
    position: { type: Number, default: 0 },
    /** Quantity price breaks: [{ minimumQuantity, price }] */
    quantityPriceBreaks: { type: mongoose.Schema.Types.Mixed, default: [] },
    /**
     * Per-unit price when the order fills a 1×40HQ container, which is how a
     * factory quotes bulk. Null when the price list leaves the column blank.
     * Kept apart from `tradePrice`, which is our own account price ex VAT.
     */
    containerPrice: { type: Number, default: null },
    /** Fabricated size, for made-to-size goods (pergolas, blinds, doors). */
    dimensionsMm: { type: VariantDimensionsSchema, default: null },
    /** Remaining supplier quotation columns, in the order they are printed. */
    attributes: { type: [VariantAttributeSchema], default: [] },
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

/** A finish sold as its own product, shown as a swatch on its siblings' PDPs. */
const SwatchSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    /** Supplier handle of the product this swatch points at. */
    handle: { type: String, default: "", trim: true },
    colorValue: { type: String, default: "", trim: true },
    secondaryColor: { type: String, default: "", trim: true },
    /** Hosted chip art (Cloudinary). */
    swatchImage: { type: String, default: "", trim: true },
    price: { type: Number, default: null },
    compareAtPrice: { type: Number, default: null },
    available: { type: Boolean, default: true },
    /** True for the product whose page this is. */
    isCurrent: { type: Boolean, default: false },
  },
  { _id: false },
);

const SwatchGroupSchema = new mongoose.Schema(
  {
    optionName: { type: String, default: "Finish", trim: true },
    swatches: { type: [SwatchSchema], default: [] },
  },
  { _id: false },
);

/** Explainer dropdown next to an option picker. */
const InfoDropdownSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    html: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    items: {
      type: [
        new mongoose.Schema(
          {
            term: { type: String, default: "", trim: true },
            text: { type: String, default: "", trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
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

/**
 * One size row of a louvered-pergola price list.
 *
 * A pergola is quoted as a grid: each size fixes how many motors and posts it
 * takes, and then carries a price per roof configuration. The sellable
 * combinations are ordinary variants (Size × Roof, priced per variant) — this
 * table is the supplier's sheet kept whole, so the specification a customer
 * reads is the one the factory published rather than something re-derived from
 * twelve variant rows.
 */
const PergolaSizeRowSchema = new mongoose.Schema(
  {
    /** Plan size as the supplier prints it, e.g. "3×3". */
    size: { type: String, required: true, trim: true },
    /** Motors the size takes, e.g. "1 motor". */
    motorSet: { type: String, default: "", trim: true },
    /** Posts supplied with this size. */
    postPcs: { type: Number, default: null },
    /** Standard post height in metres. */
    heightM: { type: Number, default: null },
    /** Roof-configuration prices, in the price list's own column order. */
    manualNoLedPrice: { type: Number, default: null },
    electricLedPrice: { type: Number, default: null },
    electricLedBlindsPrice: { type: Number, default: null },
  },
  { _id: false },
);

/** One supplier PDP accordion, kept in the order the supplier lists them. */
const ProductSectionSchema = new mongoose.Schema(
  {
    heading: { type: String, required: true, trim: true },
    /** Supplier block id, e.g. "collapsible-row-materials". */
    blockId: { type: String, default: "", trim: true },
    html: { type: String, default: "" },
    text: { type: String, default: "" },
    /** Label/value rows when the accordion is a metafield table. */
    rows: { type: [SpecRowSchema], default: [] },
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
    stock: { type: Number, default: DEFAULT_STOCK },
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
    /**
     * Videos the supplier hosts on YouTube or Vimeo rather than shipping a
     * file. The gallery plays them from an embed — there is nothing to mirror
     * — so what we keep is the id, the poster the supplier supplies, and the
     * gallery position they held on the source page.
     */
    externalVideos: { type: [ExternalVideoSchema], default: [] },
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
    /**
     * Every main category this product belongs to, by Menu slug.
     *
     * The counterpart of `subCategories` one level up. A supplier catalogue
     * cross-lists freely — a Plank dimmer module sits under Light Switches &
     * Sockets and, through its room collection, under Knobs & Handles too, and
     * a hook belongs to Hooks & Accessories without leaving cabinet hardware.
     * `category` above can hold only one of those, so it stays the primary
     * (Shopify sync, admin, legacy queries) while this array carries the rest.
     */
    categories: { type: [String], default: [], index: true },
    subCategory: { type: String },
    /**
     * Every sub-category this product belongs to, by Menu slug.
     *
     * `subCategory` above holds one slug, which cannot describe a supplier
     * catalogue: on Plank Hardware a single knob sits in Knobs, Satin Brass,
     * Kitchen and its design collection at once. This array carries the full
     * membership; `subCategory` stays as the primary for existing queries.
     */
    subCategories: { type: [String], default: [], index: true },
    /**
     * Handle this product has on the supplier's own storefront — the stable
     * key for re-syncing membership without matching on name.
     */
    sourceHandle: { type: String, default: "", trim: true, index: true },
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
    /**
     * Stock defaults to DEFAULT_STOCK rather than 0: nothing in this catalogue
     * is genuinely limited by units held, so a product saved without a figure
     * should be sellable, not silently out of stock.
     */
    stock: { type: Number, required: true, default: DEFAULT_STOCK },
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
    /**
     * Sold as a discrete fabricated unit, not by area.
     *
     * Outdoor Living also holds decking and cladding, which are priced per m²,
     * so the PDP offers that department an area calculator by default. A
     * pergola, a zipped blind and a sliding door are quoted per unit at a
     * fixed size, and quoting them per square metre is simply wrong.
     */
    soldPerUnit: { type: Boolean, default: false },
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
    /**
     * Warranty documents, shown in their own PDP tab.
     *
     * Kept apart from `manuals` and `installerGuides`: a customer looking for
     * the cover terms should not have to open a list of fitting instructions.
     */
    warrantyFiles: { type: [NamedFileSchema], default: [] },
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
    /**
     * Louvered-pergola price grid — one row per plan size, carrying the motor
     * and post counts that size takes and its price per roof configuration.
     * Empty on every other product.
     */
    pergolaSizeRows: { type: [PergolaSizeRowSchema], default: [] },
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
    /**
     * Explainer dropdowns the supplier places beside the option picker, e.g.
     * Plank Hardware's "Switch types explained".
     */
    infoDropdowns: { type: [InfoDropdownSchema], default: [] },
    /**
     * Finish pickers where each finish is its own product (Plank Hardware).
     * Swatches carry the sibling handle; the PDP resolves it to a product.
     */
    swatchGroups: { type: [SwatchGroupSchema], default: [] },
    /** Supplier PDP accordions (Delivery & Returns, Materials & Care …). */
    productSections: { type: [ProductSectionSchema], default: [] },
    /** Supplier handles behind "Add-ons for this product", in their order. */
    addonHandles: { type: [String], default: [] },
    addonsHeading: { type: String, default: "", trim: true },
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
            stock: { type: Number, default: DEFAULT_STOCK },
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
ProductSchema.index({ department: 1, categories: 1 });
ProductSchema.index({ department: 1, subCategories: 1 });
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
            stock: { type: Number, default: DEFAULT_STOCK },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  });
}
// A model compiled before these existed keeps its old schema across hot
// reloads and would drop them silently on read and write.
if (mongoose.models.Product && !mongoose.models.Product.schema.path("subCategories")) {
  mongoose.models.Product.schema.add({
    subCategories: { type: [String], default: [], index: true },
    sourceHandle: { type: String, default: "", trim: true, index: true },
  });
}
if (mongoose.models.Product && !mongoose.models.Product.schema.path("categories")) {
  mongoose.models.Product.schema.add({
    categories: { type: [String], default: [], index: true },
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
// Hot reload can keep an older compiled model without the pergola grid.
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("pergolaSizeRows")
) {
  mongoose.models.Product.schema.add({
    pergolaSizeRows: { type: [PergolaSizeRowSchema], default: [] },
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
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("swatchGroups")
) {
  mongoose.models.Product.schema.add({
    swatchGroups: { type: [SwatchGroupSchema], default: [] },
    infoDropdowns: { type: [InfoDropdownSchema], default: [] },
    productSections: { type: [ProductSectionSchema], default: [] },
  });
}
// Guarded per field group: a model compiled before a field was added keeps its
// old schema across hot reloads, and reads then drop the new field silently.
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("addonHandles")
) {
  mongoose.models.Product.schema.add({
    addonHandles: { type: [String], default: [] },
    addonsHeading: { type: String, default: "", trim: true },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("soldPerUnit")
) {
  mongoose.models.Product.schema.add({
    soldPerUnit: { type: Boolean, default: false },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("warrantyFiles")
) {
  mongoose.models.Product.schema.add({
    warrantyFiles: { type: [NamedFileSchema], default: [] },
  });
}
if (
  mongoose.models.Product &&
  !mongoose.models.Product.schema.path("externalVideos")
) {
  mongoose.models.Product.schema.add({
    externalVideos: { type: [ExternalVideoSchema], default: [] },
  });
}

// The variant subdocument needs the same guard as the top-level fields above.
// `variants` itself has always existed, so a stale compiled model passes every
// check on this file and would still drop the supplier quotation columns.
{
  const variantPath = mongoose.models.Product?.schema.path("variants") as
    | { schema?: mongoose.Schema }
    | undefined;
  const variantSchema = variantPath?.schema;
  if (variantSchema && !variantSchema.path("containerPrice")) {
    variantSchema.add({
      containerPrice: { type: Number, default: null },
      dimensionsMm: { type: VariantDimensionsSchema, default: null },
      attributes: { type: [VariantAttributeSchema], default: [] },
    });
  }
}

export const Product =
  mongoose.models.Product || mongoose.model("Product", ProductSchema);
