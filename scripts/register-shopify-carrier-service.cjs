/**
 * Register (or update) the Linx carrier service with Shopify.
 *
 * Shopify's stored rates are flat per zone; the Linx delivery rule depends on
 * the basket's departments and its goods total. A carrier service is the only
 * mechanism that lets Shopify ask for the rate at checkout time rather than
 * read it from a table — see src/app/api/shopify/carrier-service/route.ts.
 *
 * The callback must be reachable from Shopify, so this needs the public base
 * URL, not localhost. SHOPIFY_WEBHOOK_BASE_URL already holds it.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/register-shopify-carrier-service.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/register-shopify-carrier-service.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/register-shopify-carrier-service.cjs --remove --apply
 *
 *   BASE_URL=https://…   override the callback host
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const REMOVE = process.argv.includes("--remove");
const NAME = "Linx Delivery";

const CREATE = `mutation($input: DeliveryCarrierServiceCreateInput!) {
  carrierServiceCreate(input: $input) {
    carrierService { id name callbackUrl active }
    userErrors { field message }
  }
}`;

const UPDATE = `mutation($input: DeliveryCarrierServiceUpdateInput!) {
  carrierServiceUpdate(input: $input) {
    carrierService { id name callbackUrl active }
    userErrors { field message }
  }
}`;

const mask = (url) => String(url).replace(/token=[^&]+/, "token=***");

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  const base = (
    process.env.BASE_URL ||
    process.env.SHOPIFY_WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");

  if (!base || /localhost|127\.0\.0\.1/.test(base)) {
    throw new Error(
      "A public HTTPS base URL is required — set SHOPIFY_WEBHOOK_BASE_URL (ngrok or production), not localhost.",
    );
  }

  const token = (process.env.SHOPIFY_CARRIER_SERVICE_TOKEN || "").trim();
  const callbackUrl = `${base}/api/shopify/carrier-service${
    token ? `?token=${encodeURIComponent(token)}` : ""
  }`;

  const existing = await shopifyAdminRequest(
    `query { carrierServices(first: 25) { nodes { id name callbackUrl active } } }`,
  );
  const mine = existing.carrierServices.nodes.filter((n) => n.name === NAME);

  console.log(`carrier services on the shop: ${existing.carrierServices.nodes.length}`);
  for (const n of existing.carrierServices.nodes) {
    console.log(
      `   ${n.name.padEnd(18)} active=${String(n.active).padEnd(6)} ${mask(n.callbackUrl)}`,
    );
  }
  console.log(`\ncallback: ${mask(callbackUrl)}`);

  if (REMOVE) {
    if (!mine.length) {
      console.log(`nothing named "${NAME}" to remove`);
    } else if (!APPLY) {
      console.log("\nDRY RUN — add --apply to delete");
    } else {
      for (const n of mine) {
        const d = await shopifyAdminRequest(
          `mutation($id: ID!) { carrierServiceDelete(id: $id) { deletedId userErrors { message } } }`,
          { id: n.id },
        );
        console.log(`removed ${n.id} ${JSON.stringify(d.carrierServiceDelete.userErrors)}`);
      }
    }
    unregister();
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — add --apply to register/update");
    unregister();
    return;
  }

  const check = (result, key) => {
    const errs = result[key].userErrors;
    if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
    return result[key].carrierService;
  };

  /**
   * Shopify refuses to *activate* a carrier service unless Carrier Calculated
   * Shipping is enabled on the account — an Advanced plan, annual billing, or
   * Plus. Registering it inactive still succeeds, so the service and callback
   * sit ready and enabling the feature becomes the only remaining step.
   */
  const attempt = async (active) => {
    if (mine.length) {
      return check(
        await shopifyAdminRequest(UPDATE, {
          input: { id: mine[0].id, callbackUrl, active },
        }),
        "carrierServiceUpdate",
      );
    }
    return check(
      await shopifyAdminRequest(CREATE, {
        input: { name: NAME, callbackUrl, active, supportsServiceDiscovery: true },
      }),
      "carrierServiceCreate",
    );
  };

  try {
    const service = await attempt(true);
    console.log(`\nACTIVE: ${JSON.stringify(service)}`);
    console.log(
      "\nShopify will now ask this endpoint for the rate at checkout." +
        "\nThe flat rates in the delivery profile still show alongside it — remove" +
        "\nthem in Shopify Admin › Settings › Shipping so only this rate applies.",
    );
  } catch (error) {
    if (!/carrier calculated shipping/i.test(String(error.message))) throw error;
    const service = await attempt(false);
    console.log(`\nregistered but INACTIVE: ${JSON.stringify(service)}`);
    console.log(
      "\nShopify will not activate it: Carrier Calculated Shipping is not enabled" +
        "\non this account. Enable it (Advanced plan, annual billing, or Plus) and" +
        "\nre-run with --apply — the callback is already in place and tested.",
    );
  }

  unregister();
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
