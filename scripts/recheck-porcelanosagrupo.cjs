/**
 * Recheck Porcelanosa DB descriptions/specs against Product Finder (with session cookie).
 * Optionally refresh mismatched products: REFRESH=1
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/recheck-porcelanosagrupo.cjs
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://productfinder.porcelanosagrupo.com";
const SAMPLE = Math.max(1, Number(process.env.SAMPLE || 25));
const REFRESH = process.env.REFRESH === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const LOG = path.join(__dirname, "_tmp-porce-recheck.log");

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSetCookie(res) {
  const jar = {};
  const raw = res.headers.getSetCookie?.() || [];
  for (const c of raw) {
    const part = c.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function http(url, { method = "GET", body, jar } = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "*/*",
    Origin: BASE,
    Referer: `${BASE}/en/product_finder.html`,
  };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  const res = await fetch(url, {
    method,
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (jar) Object.assign(jar, parseSetCookie(res));
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

async function postJson(url, body, jar) {
  const text = await http(url, { method: "POST", body, jar });
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function ensureSession(jar) {
  await http(`${BASE}/en/product_finder.html`, { jar });
}

async function enrich(code, jar) {
  const body = {
    idioma: "3",
    unidades: "'INT'",
    productoagrupacion: code,
    codigosap: "",
  };
  let title = "";
  let description = "";
  const specs = {};
  try {
    const t = await postJson(`${BASE}/queries/pgficha2titulo.php`, body, jar);
    title = cleanText(t.Titulo?.[0]?.Descripcion || "");
  } catch {
    /* ignore */
  }
  try {
    const txt = await postJson(
      `${BASE}/queries/pgficha2textoproducto.php`,
      body,
      jar,
    );
    description = cleanText(txt.DescripcionProducto?.[0]?.Descripcion || "");
  } catch {
    /* ignore */
  }
  try {
    const car = await postJson(
      `${BASE}/queries/pgficha2caracfijas.php`,
      body,
      jar,
    );
    for (const row of car.CaracFijas || []) {
      const k = cleanText(row.Titulo);
      const v = cleanText(row.Valor);
      if (k && v) specs[k] = v;
    }
  } catch {
    /* ignore */
  }
  return { title, description, specs };
}

const META = new Set([
  "source",
  "sku",
  "sourceUrl",
  "productCode",
  "tipoproducto",
  "porcelanosaCode",
  "serie",
]);

async function main() {
  fs.writeFileSync(LOG, `Porcelanosa recheck ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "porcelanosagrupo" });
  if (!brand) throw new Error("brand missing");

  const jar = {};
  await ensureSession(jar);
  log(`Session cookies: ${Object.keys(jar).join(",") || "(none)"}`);

  let query = { brand: brand._id, "specs.source": "porcelanosa-scrape" };
  let products;
  if (REFRESH && LIMIT > 0) {
    products = await db.collection("products").find(query).limit(LIMIT).toArray();
  } else if (REFRESH) {
    products = await db.collection("products").find(query).toArray();
  } else {
    products = await db
      .collection("products")
      .aggregate([{ $match: query }, { $sample: { size: SAMPLE } }])
      .toArray();
  }

  log(`Checking ${products.length} products refresh=${REFRESH}`);

  let matched = 0;
  let weak = 0;
  let failed = 0;
  let refreshed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const code = p.specs?.productCode || p.specs?.sku;
    const label = `[${i + 1}/${products.length}] ${code}`;
    if (!code) {
      weak += 1;
      log(`${label} no code`);
      continue;
    }
    try {
      if (i && i % 40 === 0) await ensureSession(jar);
      const live = await enrich(code, jar);
      const dbKeys = Object.keys(p.specs || {}).filter((k) => !META.has(k));
      const liveKeys = Object.keys(live.specs);
      const valueMatches = dbKeys.filter(
        (k) => live.specs[k] && String(live.specs[k]) === String(p.specs[k]),
      ).length;

      const ok =
        (liveKeys.length === 0 && dbKeys.length > 0) ||
        valueMatches >= Math.min(3, liveKeys.length) ||
        (liveKeys.length > 0 && valueMatches / liveKeys.length >= 0.5);

      if (ok) matched += 1;
      else weak += 1;

      log(
        `${label} liveSpecs=${liveKeys.length} dbSpecs=${dbKeys.length} matches=${valueMatches} liveDesc=${live.description.length} dbDesc=${(p.description || "").length} ${ok ? "OK" : "WEAK"}`,
      );

      if (REFRESH && (liveKeys.length || live.description || live.title)) {
        const specs = {
          ...(p.specs || {}),
          ...live.specs,
          sku: p.specs?.sku || code,
          productCode: code,
          source: "porcelanosa-scrape",
          refreshedAt: new Date().toISOString(),
        };
        const description =
          live.description ||
          p.description ||
          `${p.name}. ${Object.entries(live.specs)
            .slice(0, 12)
            .map(([k, v]) => `${k}: ${v}`)
            .join(". ")}.`;
        await db.collection("products").updateOne(
          { _id: p._id },
          {
            $set: {
              description: cleanText(description).slice(0, 8000),
              specs,
              updatedAt: new Date(),
            },
          },
        );
        refreshed += 1;
      }
      await new Promise((r) => setTimeout(r, 60));
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
    }
  }

  log(
    JSON.stringify({ matched, weak, failed, refreshed, checked: products.length }, null, 2),
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
