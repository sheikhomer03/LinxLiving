import mongoose from "mongoose";

const MenuSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a menu name"],
      trim: true,
      maxlength: [100, "Name cannot be more than 100 characters"],
    },
    slug: {
      type: String,
      required: [true, "Please provide a slug"],
      trim: true,
      lowercase: true,
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Menu",
      default: null,
    },
    order: {
      type: Number,
      default: 0,
    },
    /**
     * Optional heading that buckets sibling subcategories under one parent,
     * e.g. Plank Hardware's "By Finish" / "By Collection" / "By Room". Only
     * meaningful on a child menu; a top-level category never carries one.
     * Empty string means ungrouped, which is the default for every menu.
     */
    group: {
      type: String,
      default: "",
      trim: true,
    },
    /**
     * Explicit link target, for entries that are not a plain collection page —
     * a filtered view (/collections/hooks/2-finish-black), a filter query, or
     * a single product. Empty means "derive the link from the slug", which is
     * how every ordinary category behaves.
     */
    url: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    image: {
      type: String,
      default: "",
      trim: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    /** Optional slug from Brand.subBrands[] (legacy single; prefer subBrands[]) */
    subBrand: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    /**
     * All Brand.subBrands[].slug values associated with this category.
     * A shared category (e.g. Thermostats) can list every manufacturer that
     * sells into it on the source catalogue.
     */
    subBrands: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
    /** LINX department this category/subcategory belongs to (optional) */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    /**
     * Taxonomy level hint:
     * - category: top-level under a department (or brand)
     * - subcategory: child menu
     */
    level: {
      type: String,
      enum: ["category", "subcategory"],
      default: "category",
    },
    shopifyCollectionId: { type: String, default: null, index: true },
    shopifySyncedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

MenuSchema.index({ slug: 1 });
MenuSchema.index({ parent: 1, order: 1 });
MenuSchema.index({ brand: 1, order: 1 });
MenuSchema.index({ department: 1, order: 1 });

// Hot reload can keep an older compiled model without `image` — ensure the path exists.
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("image")) {
  mongoose.models.Menu.schema.add({
    image: { type: String, default: "", trim: true },
  });
}

// A model compiled before `group` existed keeps its old schema across hot
// reloads and would silently drop the field on read and write.
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("group")) {
  mongoose.models.Menu.schema.add({
    group: { type: String, default: "", trim: true },
  });
}
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("url")) {
  mongoose.models.Menu.schema.add({
    url: { type: String, default: "", trim: true },
  });
}

if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("brand")) {
  mongoose.models.Menu.schema.add({
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
  });
}
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("subBrand")) {
  mongoose.models.Menu.schema.add({
    subBrand: { type: String, default: "", trim: true, lowercase: true },
  });
}
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("subBrands")) {
  mongoose.models.Menu.schema.add({
    subBrands: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
  });
}
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("department")) {
  mongoose.models.Menu.schema.add({
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    level: {
      type: String,
      enum: ["category", "subcategory"],
      default: "category",
    },
  });
}

export const Menu =
  (mongoose.models.Menu as mongoose.Model<any>) ||
  mongoose.model("Menu", MenuSchema);
