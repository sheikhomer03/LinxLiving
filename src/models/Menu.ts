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

if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("brand")) {
  mongoose.models.Menu.schema.add({
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
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
