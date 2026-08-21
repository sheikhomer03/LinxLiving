import mongoose from "mongoose";

const SettingsSchema = new mongoose.Schema(
  {
    storeName: { type: String, default: "Linx Square" },
    resendApiKey: { type: String, default: "" },
    emailFrom: { type: String, default: "" },
    /** Inbox that receives contact enquiries and new-order alerts. */
    notificationEmail: { type: String, default: "" },

    /**
     * Customer support contact details, surfaced in the header, footer,
     * product pages and Help Centre. Editable in admin so the number or
     * address can change without a deploy.
     */
    supportPhone: { type: String, default: "" },
    supportEmail: { type: String, default: "" },
    /** Opening hours line shown beside the phone number. */
    supportHours: { type: String, default: "" },
  },
  { timestamps: true },
);

export const Settings =
  mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
