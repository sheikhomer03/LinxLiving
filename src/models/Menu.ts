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
  },
  {
    timestamps: true,
  },
);

// Hot reload can keep an older compiled model without `image` — ensure the path exists.
if (mongoose.models.Menu && !mongoose.models.Menu.schema.path("image")) {
  mongoose.models.Menu.schema.add({
    image: { type: String, default: "", trim: true },
  });
}

export const Menu =
  (mongoose.models.Menu as mongoose.Model<any>) ||
  mongoose.model("Menu", MenuSchema);
