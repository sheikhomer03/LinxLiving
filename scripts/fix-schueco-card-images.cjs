/**
 * Give each Schüco window system its own square lead image.
 *
 * Two faults produced the cards you see on the homepage rail:
 *
 *  - The scrape took schuecohome.co.uk's product pages in DOM order, and those
 *    pages open with a block of brand and showroom photography that every one
 *    of them shares — Technologiezentrum, Bexley_Peep, Global_Services and the
 *    rest. So AWS 70.HI and AWS 90.SI+ both ended up leading with the identical
 *    house photograph, and the product's own picture, where it had one, sat
 *    further down the gallery or was cut off by MAX_IMAGES entirely. AWS 70.HI
 *    has a 1080x1080 shot of the system itself, AWS_70_HI_e_PASK.jpg, that
 *    never reached us at all.
 *  - What own photography these systems do have is architectural: wide or tall
 *    building shots, 25-33% off square. A square card can only bar those or
 *    crop them, which is what put white bands round three of the four.
 *
 * So the lead image is rebuilt from each product's own photograph, squared at
 * upload with `c_fill,ar_1:1,g_auto` — Cloudinary picks the subject rather than
 * the middle. Crops are 1200px against a card that renders at 400-800, so the
 * square is a downscale and loses nothing; only the outer edges of the
 * composition go, and the uncropped original stays in the gallery, so the PDP
 * still shows the whole photograph.
 *
 * The new lead is prepended, not substituted: nothing already in a gallery is
 * removed, and the rollback file restores the previous order exactly.
 *
 * Shopify serves the storefront's images, so a run must be followed by
 *   IDS=<ids> node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs
 * to mirror the new file onto their CDN. Until that runs the card falls back to
 * the Cloudinary URL, which works but is not the host we serve from.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-schueco-card-images.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-schueco-card-images.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-schueco-card-images.cjs --rollback <file.json>
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const FOLDER = "linx-living/products/schuco";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Square derivative served to the card. 1200 against a 400-800px tile. */
const SQUARE = "c_fill,ar_1:1,g_auto,w_1200,q_auto:best";

/**
 * Each product's own photograph, chosen from the images unique to its source
 * page — see _tmp-schueco-classify.cjs, which separates those from the brand
 * furniture every page repeats.
 *
 * `stored` names an image already in the gallery holding that photograph, so
 * nothing is re-uploaded needlessly. `source` is used only where the photo
 * never reached us.
 */
const TARGETS = [
  {
    id: "6a72fce6a2943fec3797f6eb",
    name: "AWS 75.SI+",
    stored: "schuco-window-system-aws-75si-1",
    note: "berwyn-road-2, 2000x1600 — already the lead, squared",
  },
  {
    id: "6a72fd0fa2943fec3797f6ec",
    name: "AWS 70.HI",
    source: "https://schuecohome.co.uk/wp-content/uploads/2024/05/AWS_70_HI_e_PASK.jpg",
    publicId: "schuco-window-system-aws-70hl-card",
    note: "AWS_70_HI_e_PASK, 1080x1080 — the system itself, never scraped",
  },
  {
    id: "6a72fd20a2943fec3797f6ed",
    name: "AWS 80 SC",
    stored: "schuco-window-system-aws-80-sc-1",
    note: "Showroom-AWS-80-SC_16, 1844x2560 — already the lead, squared",
  },
  {
    id: "6a72fd5fa2943fec3797f6ee",
    name: "AWS 90.SI+",
    // The © in the filename is served unencoded; encodeURI leaves the rest alone.
    source: encodeURI(
      "https://schuecohome.co.uk/wp-content/uploads/2024/10/Broadstone-Quarry-by-A-Zero-©-Michael-Franke_MG_1166.jpg",
    ),
    publicId: "schuco-window-system-aws-90-si-plus-card",
    note: "Broadstone Quarry MG_1166 — its own project, replacing the shared house shot",
  },
];

/** Cloudinary public id out of a delivery URL, version and extension dropped. */
function publicIdOf(url) {
  const m = /image\/upload\/(?:[^/]+\/)*?v\d+\/(.+)$/.exec(String(url || ""));
  return m ? m[1].replace(/\.[a-z0-9]+$/i, "") : "";
}

/** A delivery URL for `publicId` with the square transformation applied. */
const squareUrl = (publicId) =>
  `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${SQUARE}/${publicId}.jpg`;

async function uploadSource(url, publicId) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://schuecohome.co.uk/" },
  });
  if (!res.ok) throw new Error(`source HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: FOLDER, public_id: publicId, overwrite: true, resource_type: "image" },
      (err, out) => (err ? reject(err) : resolve(out.secure_url)),
    );
    stream.end(buf);
  });
}

/** Confirm the derived square actually renders before it is written anywhere. */
async function verify(url) {
  const r = await fetch(url);
  if (!r.ok) return { ok: false, note: `HTTP ${r.status}` };
  const b = Buffer.from(await r.arrayBuffer());
  let w = 0;
  let h = 0;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      h = b.readUInt16BE(i + 5);
      w = b.readUInt16BE(i + 7);
      break;
    }
    i += 2 + len;
  }
  return { ok: w === h && w > 0, width: w, height: h, bytes: b.length };
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const products = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let n = 0;
    for (const p of data.products || []) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { images: p.images } },
      );
      n += 1;
    }
    console.log(`rolled back ${n} product(s)`);
    await mongoose.disconnect();
    return;
  }

  const plan = [];

  for (const t of TARGETS) {
    const doc = await products.findOne(
      { _id: new mongoose.Types.ObjectId(t.id) },
      { projection: { name: 1, images: 1 } },
    );
    if (!doc) {
      console.log(`${t.name}: NOT FOUND`);
      continue;
    }
    const images = doc.images || [];

    let publicId;
    if (t.stored) {
      const match = images.find((u) => publicIdOf(u).endsWith(t.stored));
      if (!match) {
        console.log(`${t.name}: expected image ${t.stored} not in the gallery — skipped`);
        continue;
      }
      publicId = publicIdOf(match);
    } else {
      publicId = `${FOLDER}/${t.publicId}`;
      if (APPLY) {
        try {
          await uploadSource(t.source, t.publicId);
          console.log(`${t.name}: uploaded ${t.publicId}`);
        } catch (e) {
          console.log(`${t.name}: upload failed — ${e.message}`);
          continue;
        }
      }
    }

    const lead = squareUrl(publicId);
    const already = images[0] === lead;
    plan.push({ t, doc, images, lead, already });

    console.log(`\n${t.name}  (${doc.name})`);
    console.log(`   ${t.note}`);
    console.log(`   current lead : ${(images[0] || "-").split("/").pop()}`);
    console.log(`   new lead     : ${SQUARE} / ${publicId.split("/").pop()}.jpg`);
    if (already) console.log("   already in place");
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to upload and write.");
    await mongoose.disconnect();
    return;
  }

  console.log("\nverifying the derived squares render…");
  const good = [];
  for (const row of plan) {
    const v = await verify(row.lead);
    console.log(
      `   ${row.t.name.padEnd(12)} ${v.ok ? "ok" : "FAILED"}  ` +
        `${v.width}x${v.height}  ${v.bytes ? (v.bytes / 1024).toFixed(0) + "KB" : v.note || ""}`,
    );
    if (v.ok && !row.already) good.push(row);
  }

  if (!good.length) {
    console.log("\nnothing to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    products: good.map((r) => ({
      _id: String(r.doc._id),
      name: r.doc.name,
      images: r.images,
    })),
  };

  const now = new Date();
  for (const r of good) {
    // Prepend, and drop any later copy so the gallery does not repeat it.
    const rest = r.images.filter((u) => u !== r.lead);
    await products.updateOne(
      { _id: r.doc._id },
      { $set: { images: [r.lead, ...rest], updatedAt: now } },
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-schueco-card-images-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rollback, null, 2)}\n`);

  console.log(`\napplied to ${good.length} product(s)`);
  console.log(`rollback: ${file}`);
  console.log(
    `\nnow mirror to Shopify:\n  IDS=${good.map((r) => r.doc._id).join(",")} ` +
      `node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* already down */
  }
  process.exit(1);
});
