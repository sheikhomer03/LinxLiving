import { Resend } from "resend";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testResend() {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "info@linxliving.co.uk";

  if (!apiKey || apiKey === "re_xxxxxxxxxxxxxxxxxxxxxxxx") {
    console.error(
      "Error: RESEND_API_KEY is not set or is still the placeholder in .env.local",
    );
    process.exit(1);
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: "info@linxliving.co.uk",
      subject: "Test Email from Linx Square",
      html: "<strong>Resend is working correctly!</strong>",
    });

    if (error) {
      console.error("Resend Error:", error);
    } else {
    }
  } catch (err) {
    console.error("Unexpected Error:", err);
  }
}

testResend();
