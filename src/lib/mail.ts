import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: parseInt(process.env.EMAIL_SERVER_PORT || "587"),
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

export const sendResetEmail = async (email: string, otp: string) => {
  const mailOptions = {
    from: `"Linx Living " <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: "Reset Your Password - Linx Living",
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">Linx Living</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">A request has been received to reset your account password. Use the verification code below to proceed.</p>
        <div style="background: #f9f9f9; padding: 20px; text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; letter-spacing: 0.3em; font-weight: bold;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Exquisitely Crafted Surfaces & Fine Living</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

export const sendWelcomeEmail = async (email: string, name: string) => {
  const mailOptions = {
    from: `"Linx Living " <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: "Welcome to Linx Living - Exquisitely Crafted Surfaces",
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">Linx Living</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">Dear ${name},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">Welcome to Linx Living. Your account has been successfully created. You can now explore our curated collections, track your exquisite orders, and experience fine living.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/login" style="background-color: #333; color: #fff; padding: 15px 30px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; font-weight: bold; border-radius: 2px;">Sign In</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Exquisitely Crafted Surfaces & Fine Living</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

export const sendOrderConfirmation = async (email: string, order: any) => {
  const formatCur = (amount: number) => "£" + amount.toFixed(2);
  const itemsHtml = order.items
    .map(
      (item: any) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">
        <p style="margin: 0; font-weight: bold;">${item.name || "Linx Living Product"}</p>
        <p style="margin: 0; font-size: 12px; color: #666;">Qty: ${item.quantity}</p>
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">
        ${formatCur(item.price * item.quantity)}
      </td>
    </tr>
  `,
    )
    .join("");

  const mailOptions = {
    from: `"Linx Living " <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: `Order Confirmation - #${order.orderNumber} - Linx Living`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">Linx Living</h2>
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
  };

  await transporter.sendMail(mailOptions);
};

export const sendOrderAdminNotification = async (
  order: any,
  userDetails: any,
) => {
  const mailOptions = {
    from: `"Linx Living System" <${process.env.EMAIL_FROM}>`,
    to: process.env.EMAIL_FROM, // Send to admin
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
  };

  await transporter.sendMail(mailOptions);
};

export const sendOrderStatusUpdate = async (
  email: string,
  order: any,
  newStatus: string,
) => {
  const mailOptions = {
    from: `"Linx Living " <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: `Order Status Update - #${order.orderNumber} - Linx Living`,
    html: `
      <div style="font-family: serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee;">
        <h2 style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;">Linx Living</h2>
        <div style="text-align: center; margin: 30px 0;">
          <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.2em; color: #666; margin-bottom: 5px;">Order #${order.orderNumber}</p>
          <h3 style="font-size: 24px; margin: 0; color: #333;">Your order is now: <strong>${newStatus}</strong></h3>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; text-align: center;">You can track the progress of your order in your Linx Living profile.</p>
        
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/profile/orders/${order._id}" style="background-color: #333; color: #fff; padding: 15px 30px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.2em; font-size: 12px; font-weight: bold; border-radius: 2px;">Track Order</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Exquisitely Crafted Surfaces & Fine Living</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};
