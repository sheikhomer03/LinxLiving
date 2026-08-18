/**
 * Pause and resume the product webhooks around a bulk push.
 *
 * Shopify fires `products/create` the moment we create a product, and the
 * inbound handler decides whether that product is new by looking for its GID in
 * Mongo. During a bulk push the GID has not been written back yet — the product
 * was created milliseconds ago — so the handler concludes Shopify has a product
 * Mongo does not, and creates a duplicate of the row we just pushed from.
 *
 * The push narrows that window by writing each GID back immediately, but it
 * cannot close it: the webhook can always arrive first. For a run of eighteen
 * thousand products, "always" happens. So the product webhooks come down for
 * the duration and go back up afterwards.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/shopify-product-webhooks.cjs list
 *   node --require ./scripts/mongo-dns.cjs scripts/shopify-product-webhooks.cjs pause
 *   node --require ./scripts/mongo-dns.cjs scripts/shopify-product-webhooks.cjs resume
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const MODE = (process.argv[2] || "list").toLowerCase();
const STATE = path.join(__dirname, ".shopify-paused-webhooks.json");

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  const list = async () => {
    const data = await shopifyAdminRequest(`
      query {
        webhookSubscriptions(first: 100) {
          nodes {
            id
            topic
            endpoint { ... on WebhookHttpEndpoint { callbackUrl } }
          }
        }
      }
    `);
    return data.webhookSubscriptions.nodes;
  };

  const all = await list();
  const product = all.filter((n) => String(n.topic).startsWith("PRODUCTS_"));

  if (MODE === "list") {
    console.log(`${all.length} subscription(s), ${product.length} on products:`);
    for (const n of all) {
      const mark = String(n.topic).startsWith("PRODUCTS_") ? "*" : " ";
      console.log(`${mark} ${n.topic.padEnd(22)} ${n.endpoint?.callbackUrl || "(non-http)"}`);
    }
    unregister();
    return;
  }

  if (MODE === "pause") {
    if (!product.length) {
      console.log("no product webhooks registered — nothing to pause");
      unregister();
      return;
    }
    const saved = product.map((n) => ({
      topic: n.topic,
      callbackUrl: n.endpoint?.callbackUrl || "",
    }));
    fs.writeFileSync(STATE, JSON.stringify(saved, null, 2));

    for (const n of product) {
      const data = await shopifyAdminRequest(
        `mutation Delete($id: ID!) {
          webhookSubscriptionDelete(id: $id) {
            deletedWebhookSubscriptionId
            userErrors { message }
          }
        }`,
        { id: n.id },
      );
      const errs = data.webhookSubscriptionDelete.userErrors;
      console.log(
        `paused ${n.topic}${errs.length ? ` — ${errs.map((e) => e.message).join("; ")}` : ""}`,
      );
    }
    console.log(`\n${saved.length} paused; recorded in ${STATE}`);
    console.log("run this script with `resume` when the bulk push is finished");
    unregister();
    return;
  }

  if (MODE === "resume") {
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(STATE, "utf8"));
    } catch {
      console.error(`No paused webhooks recorded at ${STATE}`);
      process.exit(1);
    }

    for (const entry of saved) {
      if (product.some((n) => n.topic === entry.topic)) {
        console.log(`${entry.topic} already registered — skipped`);
        continue;
      }
      const data = await shopifyAdminRequest(
        `mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
            webhookSubscription { id topic }
            userErrors { message }
          }
        }`,
        {
          topic: entry.topic,
          sub: { callbackUrl: entry.callbackUrl, format: "JSON" },
        },
      );
      const errs = data.webhookSubscriptionCreate.userErrors;
      console.log(
        `resumed ${entry.topic}${errs.length ? ` — ${errs.map((e) => e.message).join("; ")}` : ""}`,
      );
    }
    fs.unlinkSync(STATE);
    unregister();
    return;
  }

  console.error(`Unknown mode "${MODE}" — use list, pause or resume`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
