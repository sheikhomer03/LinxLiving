/**
 * Re-fetch Sterlingbuild descriptions for products whose copy is missing / nav junk.
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/refresh-sterling-descriptions.cjs
 */
require("dotenv").config({ path: ".env" });
const { connectMongo } = require("./mongo-connect.cjs");

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractProductDescription(md) {
  const junkPara =
    /Skip to Content|Add to Wishlist|Product Code|Markdown Content|URL Source|Title:|We use cookies|We value your privacy|Customise Consent|cookieyes|Necessary cookies|Accept All/i;

  let raw = String(md || "");
  const start = raw.search(/Short Description|Product Highlights|Why Choose/i);
  if (start >= 0) {
    raw = raw.slice(start);
  } else {
    const paras = String(md || "")
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const prose = paras.find(
      (p) =>
        p.length > 120 &&
        !junkPara.test(p) &&
        !/^!\[/.test(p) &&
        !/^\|/.test(p),
    );
    if (prose) raw = prose;
    else raw = "";
  }

  if (!raw) return "";

  const cut = raw.search(
    /More Information|From\s*£|Add to Wishlist|Add To Bag|Est\.?\s*delivery|Click\s*&\s*Collect|Checkout as|You may also need|Qty\s*-|Window Size|Choose product options|Creating an account|Forgot Your Password|##\s*Products|Skip to Content|We use cookies/i,
  );
  if (cut > 40) raw = raw.slice(0, cut);

  raw = raw
    .replace(/^Short Description\s*/i, "")
    .replace(/^Product Highlights\s*/i, "")
    .replace(/^Why Choose[^\n]*\s*/i, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)"]*\)?/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\*+/g, " ")
    .replace(/#{1,6}\s*/g, "")
    .replace(/https?:\/\/\S+/g, " ");

  const out = cleanText(raw).slice(0, 4000);
  if (!out || out.length < 40 || junkPara.test(out) || /\[Saved\]/i.test(out)) {
    return "";
  }
  return out;
}

async function fetchViaJina(url) {
  const endpoint = `https://r.jina.ai/${url}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
    },
  });
  if (!res.ok) throw new Error(`Jina ${res.status} for ${url}`);
  return res.text();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const conn = await connectMongo();
  const db = conn.db;
  const brand = await db.collection("brands").findOne({ slug: "sterlingbuild" });
  if (!brand) throw new Error("sterlingbuild brand not found");

  const bad = await db
    .collection("products")
    .find({
      brand: brand._id,
      $or: [
        { description: { $regex: /Skip to Content|Help & FAQs|\[Saved\]/i } },
        { description: { $exists: false } },
        { description: "" },
        { description: { $regex: /^.{0,50}$/ } },
      ],
    })
    .project({ name: 1, description: 1, specs: 1 })
    .toArray();

  console.log(`Refreshing ${bad.length} Sterlingbuild descriptions...`);
  let ok = 0;
  let fallback = 0;
  let fail = 0;

  for (let i = 0; i < bad.length; i++) {
    const p = bad[i];
    const url = p.specs?.sourceUrl;
    process.stdout.write(`[${i + 1}/${bad.length}] ${p.name.slice(0, 50)}... `);
    if (!url) {
      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { description: p.name, updatedAt: new Date() } },
      );
      fallback++;
      console.log("no url → name");
      continue;
    }
    try {
      const md = await fetchViaJina(url);
      let desc = extractProductDescription(md);
      if (!desc) desc = p.name;
      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { description: desc, updatedAt: new Date() } },
      );
      if (desc === p.name) {
        fallback++;
        console.log(`fallback name (${md.length}b)`);
      } else {
        ok++;
        console.log(`ok (${desc.length} chars)`);
      }
    } catch (e) {
      fail++;
      console.log(`FAIL ${e.message}`);
      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { description: p.name, updatedAt: new Date() } },
      );
    }
    await delay(700);
  }

  console.log(JSON.stringify({ total: bad.length, ok, fallback, fail }, null, 2));
  await conn.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
