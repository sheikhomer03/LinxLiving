/**
 * Print a fresh Shopify hosted-checkout URL.
 *
 *   node scripts/fresh-checkout-url.cjs
 *   QUERY="shower tray" node scripts/fresh-checkout-url.cjs
 *   QTY=2 node scripts/fresh-checkout-url.cjs
 *
 * Written for handing a working checkout to Shopify support while they debug
 * the Klarna region provisioning. A checkout session is short-lived and tied
 * to the cart that made it, so a link copied out of the browser an hour ago is
 * already dead by the time support opens it — which is what happened. This
 * makes a brand new one in a couple of seconds, as many times as needed.
 *
 * Nothing here depends on the storefront being deployed. The cart is created
 * through the Storefront API and the URL it returns is hosted on Shopify, so
 * the link works for anyone regardless of where (or whether) the Next.js app
 * is running.
 *
 * `buyerIdentity.countryCode` is sent to match src/lib/shopify/cart.ts, so the
 * checkout support sees is the same one a real customer would get.
 */
const fs = require("fs");
const path = require("path");

/** Minimal .env reader — a plain node script gets none of Next's loading. */
function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim().replace(/\s+#.*$/, "");
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnv();

const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const TOKEN = (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "").trim();
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const COUNTRY = (process.env.NEXT_PUBLIC_STOREFRONT_COUNTRY || "GB").toUpperCase();
const QUERY = process.env.QUERY || "";
const QTY = Number(process.env.QTY || 1);

if (!DOMAIN) throw new Error("SHOPIFY_STORE_DOMAIN is not set");
if (!TOKEN) throw new Error("SHOPIFY_STOREFRONT_ACCESS_TOKEN is not set");

const ENDPOINT = `https://${DOMAIN}/api/${VERSION}/graphql.json`;

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

/** First in-stock variant, preferring the dearest so it clears BNPL minimums. */
async function pickVariant() {
  const data = await gql(
    `query Pick($q: String) {
       products(first: 50, query: $q) {
         nodes {
           title
           variants(first: 10) {
             nodes {
               id
               title
               availableForSale
               price { amount currencyCode }
             }
           }
         }
       }
     }`,
    { q: QUERY || null },
  );

  const options = [];
  for (const p of data.products.nodes) {
    for (const v of p.variants.nodes) {
      if (!v.availableForSale) continue;
      options.push({
        id: v.id,
        title: `${p.title}${v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""}`,
        price: Number(v.price.amount),
        currency: v.price.currencyCode,
      });
    }
  }
  if (!options.length) {
    throw new Error(
      QUERY
        ? `No purchasable variant matched QUERY="${QUERY}"`
        : "No purchasable variant found",
    );
  }
  options.sort((a, b) => b.price - a.price);
  return options[0];
}

(async () => {
  const v = await pickVariant();

  const data = await gql(
    `mutation Create($input: CartInput!) {
       cartCreate(input: $input) {
         cart { id checkoutUrl cost { totalAmount { amount currencyCode } } }
         userErrors { field message }
       }
     }`,
    {
      input: {
        lines: [{ merchandiseId: v.id, quantity: QTY }],
        buyerIdentity: { countryCode: COUNTRY },
      },
    },
  );

  const errs = data.cartCreate.userErrors;
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));

  const cart = data.cartCreate.cart;
  const total = cart.cost.totalAmount;

  console.log("");
  console.log("  Item   :", v.title);
  console.log("  Qty    :", QTY);
  console.log("  Total  :", `${total.currencyCode} ${Number(total.amount).toFixed(2)}`);
  console.log("  Country:", COUNTRY);
  console.log("");
  console.log("  FRESH CHECKOUT URL — send this now, it expires:");
  console.log("");
  console.log("   ", cart.checkoutUrl);
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
