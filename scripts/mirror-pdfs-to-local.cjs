/**
 * Bring the last Cloudinary-hosted product documents onto local disk.
 *
 * Nearly every guide and datasheet in the catalogue is already served from
 * `public/<brand>/downloads/<product>/…` — 1,467 guides and 4,738 downloads.
 * Otto Tiles' 287 installation guides are the exception: they were uploaded to
 * Cloudinary as `raw/upload` and still point there.
 *
 * Documents are deliberately not sent to Shopify. They are site content, linked
 * from the PDP, and the rest of the catalogue already serves them from disk;
 * putting these one brand's copies in a shop's Files library would leave the
 * same kind of asset in two unrelated places.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/mirror-pdfs-to-local.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/mirror-pdfs-to-local.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/mirror-pdfs-to-local.cjs --rollback <file.json>
 *
 *   FORCE=1   re-download files already on disk
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const FORCE = process.env.FORCE === "1";
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const PUBLIC = path.join(__dirname, "..", "public");

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

/** The filename Cloudinary serves, normalised and always ending .pdf. */
function fileNameFor(url, title, index) {
  const last = decodeURIComponent(String(url).split("?")[0].split("/").pop() || "");
  const base = slugify(last.replace(/\.pdf$/i, "")) || slugify(title) || `guide-${index + 1}`;
  return `${base}.pdf`;
}

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0;
  for (const p of data.products || []) {
    await db
      .collection("products")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { installationMaintenanceGuides: p.guides } },
      );
    n += 1;
  }
  console.log(`restored guide URLs on ${n} product(s)`);
  console.log("downloaded files were left on disk; delete public/ copies by hand if unwanted");
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  if (ROLLBACK) {
    await runRollback(db, ROLLBACK);
    await mongoose.disconnect();
    return;
  }

  const brands = await db.collection("brands").find({}).project({ slug: 1, name: 1 }).toArray();
  const brandSlug = new Map(brands.map((b) => [String(b._id), b.slug]));

  const products = await db
    .collection("products")
    .find({ "installationMaintenanceGuides.url": { $regex: "cloudinary", $options: "i" } })
    .project({ name: 1, brand: 1, sourceHandle: 1, installationMaintenanceGuides: 1 })
    .toArray();

  console.log(`${products.length} product(s) with Cloudinary-hosted guides\n`);

  const plan = [];
  for (const p of products) {
    const slug = brandSlug.get(String(p.brand)) || "misc";
    const handle = slugify(p.sourceHandle || p.name);
    const guides = p.installationMaintenanceGuides || [];

    const items = [];
    guides.forEach((g, i) => {
      const url = String(g?.url || "");
      if (!/cloudinary/i.test(url)) return;
      const name = fileNameFor(url, g?.title, i);
      const rel = `/${slug}/downloads/${handle}/${name}`;
      items.push({ index: i, url, rel, abs: path.join(PUBLIC, rel.replace(/^\//, "")) });
    });
    if (items.length) plan.push({ product: p, items });
  }

  const fileCount = plan.reduce((n, x) => n + x.items.length, 0);
  console.log(`${fileCount} file(s) to mirror into public/\n`);
  for (const { product, items } of plan.slice(0, 4)) {
    console.log(`  ${String(product.name).slice(0, 44)}`);
    for (const it of items) console.log(`     ${it.rel}`);
  }
  if (plan.length > 4) console.log(`  … and ${plan.length - 4} more products`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to download and rewrite.");
    await mongoose.disconnect();
    return;
  }

  // The rollback is written before anything is touched, not after.
  //
  // A previous run lost its network mid-way and exited without ever reaching
  // the write at the end, leaving a hundred and sixty products rewritten and no
  // record of what they had held. A safety net that only exists when the job
  // succeeds is not a safety net.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackFile = path.join(process.cwd(), `rollback-local-pdfs-${stamp}.json`);
  fs.writeFileSync(
    rollbackFile,
    JSON.stringify(
      {
        products: plan.map(({ product }) => ({
          _id: String(product._id),
          guides: product.installationMaintenanceGuides,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`  rollback written up front: ${rollbackFile}`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (const { product, items } of plan) {
    const guides = JSON.parse(JSON.stringify(product.installationMaintenanceGuides || []));

    for (const it of items) {
      try {
        if (fs.existsSync(it.abs) && !FORCE) {
          skipped += 1;
        } else {
          const res = await fetch(it.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          fs.mkdirSync(path.dirname(it.abs), { recursive: true });
          fs.writeFileSync(it.abs, buf);
          downloaded += 1;
        }
        guides[it.index] = { ...guides[it.index], url: it.rel };
      } catch (error) {
        failed += 1;
        console.error(`  ✗ ${it.rel} — ${String(error.message).slice(0, 80)}`);
      }
    }

    await db
      .collection("products")
      .updateOne({ _id: product._id }, { $set: { installationMaintenanceGuides: guides } });

    if ((downloaded + skipped) % 50 === 0) {
      console.log(`  ${downloaded + skipped}/${fileCount} …`);
    }
  }

  console.log(
    `\ndownloaded ${downloaded}, already present ${skipped}, failed ${failed}` +
      `\nrewrote guide URLs on ${plan.length} product(s)` +
      `\nrollback: ${rollbackFile}`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
