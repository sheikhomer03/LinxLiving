import { Resend } from "resend";
import { getSettings } from "@/app/actions/settings";

/** Resend only allows sending from verified domains (or their test address). */
const RESEND_TEST_FROM = "beth.t@example.com";
const BLOCKED_FROM_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "example.com",
  "mail.com",
  "protonmail.com",
  "proton.me",
]);

function resolveFromEmail(candidate?: string | null) {
  const email = (candidate || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return RESEND_TEST_FROM;

  const domain = email.split("@")[1] || "";
  if (BLOCKED_FROM_DOMAINS.has(domain)) {
    console.warn(
      `Resend From "${email}" is not allowed (unverified consumer domain). Using ${RESEND_TEST_FROM} instead.`,
    );
    return RESEND_TEST_FROM;
  }

  return email;
}

const getResendConfig = async () => {
  const settings = await getSettings();
  const apiKey = settings?.resendApiKey || process.env.RESEND_API_KEY;
  const fromEmail = resolveFromEmail(
    settings?.emailFrom || process.env.EMAIL_FROM || RESEND_TEST_FROM,
  );

  if (!apiKey) {
    console.error("DEBUG: Resend API Key not found");
  }

  console.log(
    `DEBUG: Resend Config - From: ${fromEmail}, API Key: ${apiKey ? "PRESENT" : "MISSING"}`,
  );

  return {
    resend: new Resend(apiKey),
    fromEmail,
  };
};

export const sendResetEmail = async (email: string, otp: string) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const { data, error } = await resend.emails.send({
    from: `"${storeName} " <${fromEmail}>`,
    to: email,
    cc: "info@linxliving.co.uk",
    subject: `Reset Your Password - ${storeName}`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">${storeName}</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">A request has been received to reset your account password. Use the verification code below to proceed.</p>
        <div style="background: #f9f9f9; padding: 20px; text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; letter-spacing: 0.3em; font-weight: bold;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Exquisitely Crafted Surfaces & Fine Living</p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error(error.message);
  }

  return data;
};

export const sendWelcomeEmail = async (email: string, name: string) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const { data, error } = await resend.emails.send({
    from: `"${storeName} " <${fromEmail}>`,
    to: email,
    cc: "info@linxliving.co.uk",
    subject: `Welcome to ${storeName} - Exquisitely Crafted Surfaces`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">${storeName}</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">Dear ${name},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">Welcome to ${storeName}. Your account has been successfully created. You can now explore our architectural catalog, track your exquisite orders, and experience fine living.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/login" style="background-color: #333; color: #fff; padding: 15px 30px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; font-weight: bold; border-radius: 2px;">Sign In</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Exquisitely Crafted Surfaces & Fine Living</p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error(error.message);
  }

  return data;
};

export const sendOrderConfirmation = async (email: string, order: any) => {
  console.log(
    `DEBUG: sendOrderConfirmation called for ${email} (Order: ${order?.orderNumber})`,
  );
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const formatCur = (amount: number) => "£" + amount.toFixed(2);
  const itemsHtml = order.items
    .map(
      (item: any) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">
        <p style="margin: 0; font-weight: bold;">${item.name || `${storeName} Product`}</p>
        <p style="margin: 0; font-size: 12px; color: #666;">Qty: ${item.quantity}</p>
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">
        ${formatCur(item.price * item.quantity)}
      </td>
    </tr>
  `,
    )
    .join("");

  const { data, error } = await resend.emails.send({
    from: `"${storeName} " <${fromEmail}>`,
    to: email,
    cc: "info@linxliving.co.uk",
    subject: `Order Confirmation - #${order.orderNumber} - ${storeName}`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">${storeName}</h2>
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="text-transform: uppercase; letter-spacing: 0.1em; font-size: 12px; color: #666;">Order Confirmed</p>
          <h3 style="font-size: 24px; margin: 0;">#${order.orderNumber}</h3>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">Thank you for your order. We are preparing it for shipment and will notify you once it's on the way.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 30px;">
          ${itemsHtml}
          <tr>
            <td style="padding: 15px 10px; text-align: right; font-weight: bold;">Total</td>
            <td style="padding: 15px 10px; text-align: right; font-weight: bold; font-size: 18px;">
              ${formatCur(order.totalAmount)}
            </td>
          </tr>
        </table>
        
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/profile/orders/${order._id}" style="background-color: #333; color: #fff; padding: 15px 30px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; font-weight: bold; border-radius: 2px;">View Order Status</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Exquisitely Crafted Surfaces & Fine Living</p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error(error.message);
  }

  return data;
};

export const sendOrderAdminNotification = async (
  order: any,
  userDetails: any,
) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const { data, error } = await resend.emails.send({
    from: `"${storeName} System" <${fromEmail}>`,
    to: fromEmail, // Send to admin
    subject: `New Order Received - #${order.orderNumber}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2>New Order Notification</h2>
        <p><strong>Order Number:</strong> #${order.orderNumber}</p>
        <p><strong>Total Amount:</strong> £${order.totalAmount.toFixed(2)}</p>
        <p><strong>Customer Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</p>
        <p><strong>Customer Email:</strong> ${userDetails.email}</p>
        <p><strong>Shipping Country:</strong> ${order.shippingAddress.country}</p>
        <hr/>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/admin/orders/${order._id}" style="display: inline-block; padding: 10px 20px; background: #000; color: white; text-decoration: none; border-radius: 4px;">View in Admin Dashboard</a>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", error);
    throw new Error(error.message);
  }

  return data;
};

export const sendOrderStatusUpdate = async (
  email: string,
  order: any,
  newStatus: string,
) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const customerName =
    [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
      .filter(Boolean)
      .join(" ") || "Valued Customer";

  const statusMessages: Record<string, { headline: string; body: string }> = {
    Processing: {
      headline: "Your order is being processed",
      body: "We've received your order and our team is reviewing the details before confirmation.",
    },
    "Confirmed Order": {
      headline: "Your order has been confirmed",
      body: "Great news — we've confirmed your order. Our specialists will now prepare your pieces with care.",
    },
    Shipped: {
      headline: "Your order is on its way",
      body: "Your order has left our workshop and is now in transit to your delivery address.",
    },
    "Out for Delivery": {
      headline: "Out for delivery today",
      body: "Your order is out for delivery and should arrive shortly. Please ensure someone is available to receive it.",
    },
    Delivered: {
      headline: "Your order has been delivered",
      body: "Your order has been marked as delivered. We hope you enjoy your new pieces from Linx Square.",
    },
    Cancelled: {
      headline: "Your order has been cancelled",
      body: "Your order has been cancelled. If you did not request this or have questions, please contact our client service team.",
    },
  };

  const copy = statusMessages[newStatus] || {
    headline: `Order update: ${newStatus}`,
    body: `Your order status has been updated to ${newStatus}.`,
  };

  const itemsHtml = (order.items || [])
    .map(
      (item: any) => `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #333;">
            ${item.name}
            <div style="font-size: 12px; color: #888; margin-top: 4px;">Qty ${item.quantity}</div>
          </td>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #333; text-align: right;">
            £${Number(item.price * item.quantity).toFixed(2)}
          </td>
        </tr>`,
    )
    .join("");

  const { data, error } = await resend.emails.send({
    from: `"${storeName}" <${fromEmail}>`,
    to: email,
    subject: `${copy.headline} — #${order.orderNumber}`,
    html: `
      <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee; background: #fff;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center; color: #1a1a1a; margin: 0 0 8px;">${storeName}</h2>
        <p style="text-align: center; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: #C5A059; margin: 0 0 32px;">Order Update</p>

        <p style="font-size: 16px; line-height: 1.6; color: #333;">Dear ${customerName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">${copy.body}</p>

        <div style="background: #f8f6f2; padding: 24px; margin: 28px 0; text-align: center;">
          <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin: 0 0 8px;">Order #${order.orderNumber}</p>
          <p style="font-size: 22px; margin: 0; color: #1a1a1a; letter-spacing: 0.06em;">${newStatus}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
          ${itemsHtml}
          <tr>
            <td style="padding: 16px 0 0; font-size: 14px; font-weight: bold; color: #1a1a1a;">Total</td>
            <td style="padding: 16px 0 0; font-size: 14px; font-weight: bold; color: #1a1a1a; text-align: right;">
              £${Number(order.totalAmount).toFixed(2)}
            </td>
          </tr>
        </table>

        <div style="text-align: center; margin: 36px 0 16px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/profile/orders/${order._id}" style="background-color: #1a1a1a; color: #fff; padding: 14px 28px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.2em; font-size: 11px; font-weight: bold; display: inline-block;">View Order</a>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center; line-height: 1.6;">
          Questions? Contact us at <a href="mailto:info@linxliving.co.uk" style="color: #C5A059;">info@linxliving.co.uk</a>
          or call 020 4634 2203.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error(
      `Resend error (OrderStatusUpdate) - From: ${fromEmail}, To: ${email}:`,
      error,
    );
    throw new Error(error.message);
  }

  return data;
};

export const sendContactConfirmationEmail = async (
  email: string,
  name: string,
) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const { data, error } = await resend.emails.send({
    from: `"${storeName}" <${fromEmail}>`,
    to: email,
    cc: "info@linxliving.co.uk",
    subject: `Thank you for contacting ${storeName}`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">Message Received</h2>
        <p>Dear ${name},</p>
        <p>Thank you for reaching out to **${storeName}**. We have received your inquiry and our team will get back to you shortly.</p>
        <p>Best regards,<br/>The ${storeName} Team</p>
      </div>
    `,
  });

  if (error) {
    console.error(
      `Resend error (ContactConfirmation) - From: ${fromEmail}, To: ${email}:`,
      error,
    );
    throw new Error(error.message);
  }

  return data;
};

export const sendContactAdminNotification = async (
  name: string,
  email: string,
  subject: string,
  message: string,
) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const { data, error } = await resend.emails.send({
    from: `"${storeName} System" <${fromEmail}>`,
    to: fromEmail,
    cc: "info@linxliving.co.uk",
    subject: `New Inquiry: ${subject}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.1em; color: #333;">New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <div style="padding: 20px; background: #f9f9f9; border-radius: 4px; color: #555;">
          ${message}
        </div>
      </div>
    `,
  });

  if (error) {
    console.error(
      `Resend error (ContactAdmin) - From: ${fromEmail}, To: ${fromEmail}:`,
      error,
    );
    throw new Error(error.message);
  }

  return data;
};

export const sendNewsletterWelcomeEmail = async (email: string) => {
  const { resend, fromEmail } = await getResendConfig();
  const settings = await getSettings();
  const storeName = settings?.storeName || "Linx Square";

  const { data, error } = await resend.emails.send({
    from: `"${storeName}" <${fromEmail}>`,
    to: email,
    cc: "info@linxliving.co.uk",
    subject: `Welcome to the ${storeName} Newsletter`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">Welcome to our Inner Circle</h2>
        <p>Thank you for subscribing to the **${storeName}** newsletter.</p>
        <p>You'll now be the first to know about new arrivals, curated design inspiration, and private acquisition opportunities.</p>
        <p>Warmest regards,<br/>The ${storeName} Team</p>
      </div>
    `,
  });

  if (error) {
    console.error(
      `Resend error (Newsletter) - From: ${fromEmail}, To: ${email}:`,
      error,
    );
    throw new Error(error.message);
  }

  return data;
};
