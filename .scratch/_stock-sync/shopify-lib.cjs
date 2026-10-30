// Shared read/write helpers for Shopify Admin GraphQL (token via client_credentials).
const fs = require("fs"), path = require("path");
const root = "/Users/niazig/Desktop/linxliving/LinxLiving";
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const API = "2025-07";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token;
async function init() {
  if (token) return;
  if (env.SHOPIFY_ADMIN_ACCESS_TOKEN) { token = env.SHOPIFY_ADMIN_ACCESS_TOKEN; return; }
  const res = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }),
  });
  token = (await res.json()).access_token;
  if (!token) throw new Error("no Shopify token");
}
async function gql(query, variables, attempt = 0) {
  await init();
  const res = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${API}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  let j; try { j = await res.json(); } catch { j = { errors: [{ message: "HTTP " + res.status }] }; }
  const throttled = (j.errors || []).some((e) => e.extensions?.code === "THROTTLED") || res.status === 429;
  if ((throttled || res.status >= 500) && attempt < 8) { await sleep(2000 * (attempt + 1)); return gql(query, variables, attempt + 1); }
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 500));
  return j.data;
}
module.exports = { gql, env, sleep, root };
