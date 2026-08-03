import mongoose from "mongoose";

const SettingsSchema = new mongoose.Schema(
  {
    storeName: { type: String, default: "Linx Square" },
    resendApiKey: { type: String, default: "" },
    emailFrom: { type: String, default: "" },
    /** Inbox that receives contact enquiries and new-order alerts. */
    notificationEmail: { type: String, default: "" },
  },
  { timestamps: true },
);

export const Settings =
  mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
