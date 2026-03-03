import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    image: { type: String },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    resetOTP: { type: String },
    resetOTPExpiry: { type: Date },
    wishlist: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
  },
  { timestamps: true },
);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
