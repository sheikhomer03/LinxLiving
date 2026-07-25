import mongoose from "mongoose";

const ContactQuerySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please provide your email address"],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    subject: {
      type: String,
      required: [true, "Please provide a subject"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Please provide a message"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "replied", "archived"],
      default: "pending",
    },
    shopifyMetaobjectId: { type: String, default: null, index: true },
    shopifySyncedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

export const ContactQuery =
  mongoose.models.ContactQuery ||
  mongoose.model("ContactQuery", ContactQuerySchema);
