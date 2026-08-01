import mongoose from "mongoose";

/**
 * Top level of LINX catalogue hierarchy:
 * Department → Category → Subcategory → Products
 * Brands remain a separate cross-cutting layer.
 */
const DepartmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide a department name"],
      trim: true,
      maxlength: [120, "Name cannot be more than 120 characters"],
    },
    slug: {
      type: String,
      required: [true, "Please provide a slug"],
      trim: true,
      lowercase: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
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
  },
  { timestamps: true },
);

DepartmentSchema.index({ order: 1, name: 1 });
DepartmentSchema.index({ isActive: 1, order: 1 });

export const Department =
  (mongoose.models.Department as mongoose.Model<any>) ||
  mongoose.model("Department", DepartmentSchema);
