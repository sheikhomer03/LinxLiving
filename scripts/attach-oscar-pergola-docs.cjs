/**
 * Attach Oscar's supplier documents to the four louvered pergolas.
 *
 * The installer guide (PDF + video) goes on `installerGuides`, which the PDP
 * renders as the "Installer Guide" tab. The catalogue goes on `manuals`, which
 * renders as the "Manuals" accordion inside the Description tab.
 *
 * Both fields are set wholesale rather than pushed to, so a re-run is a no-op
 * and the script stays the source of truth for what these products carry.
 * `scripts/import-oscar-pergolas.cjs` sets the same values on a fresh import.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/attach-oscar-pergola-docs.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/attach-oscar-pergola-docs.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/attach-oscar-pergola-docs.cjs --rollback <file.json>
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const HANDLES = [
  "oscar-louvered-pergola-type-150",
  "oscar-louvered-pergola-type-175",
  "oscar-louvered-pergola-type-200",
  "oscar-louvered-pergola-type-220",
];

/**
 * Files live in `public/oscar`. The supplier's filenames carry spaces and a
 * "(1)", so they go through encodeURI rather than being hand-escaped.
 *
 * The installation PDF and video are the factory's Type-145/175 set. Oscar
 * ships no separate document for Type-200/220 — the frame differs, the
 * assembly sequence does not — so all four products carry the same pair.
 */
const INSTALLER_GUIDES = [
  {
    name: "Louvered Pergola Installation Instructions (PDF)",
    url: encodeURI("/oscar/Type145.175 Louvered Pergola Installation Instruction.pdf"),
  },
  {
    name: "Louvered Pergola Installation Video (MP4)",
    url: encodeURI("/oscar/Type175 145 Installation.mp4"),
  },
];

const MANUALS = [
  {
    name: "Oscar Pergola Catalogue (PDF)",
    url: encodeURI("/oscar/Oscar pergola catalog.(1).pdf"),
  },
];

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const products = mongoose.connection.db.collection("products");

  if (ROLLBACK) {
    const plan = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const row of plan.previous || []) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(row.id) },
        {
          $set: {
            installerGuides: row.installerGuides,
            manuals: row.manuals,
            updatedAt: new Date(),
          },
        },
      );
    }
    console.log(`Restored ${(plan.previous || []).length} product(s)`);
    await mongoose.disconnect();
    return;
  }

  // Every referenced file must be on disk — a 404 on the PDP is worse than a
  // missing tab, and these are large binaries that are easy to forget to copy.
  for (const f of [...INSTALLER_GUIDES, ...MANUALS]) {
    const onDisk = path.join(__dirname, "..", "public", decodeURI(f.url).replace(/^\//, ""));
    if (!fs.existsSync(onDisk)) throw new Error(`Missing file: ${onDisk}`);
  }

  const rollback = { previous: [] };
  let matched = 0;

  for (const handle of HANDLES) {
    const doc = await products.findOne(
      { sourceHandle: handle },
      { projection: { name: 1, installerGuides: 1, manuals: 1 } },
    );
    if (!doc) {
      console.log(`MISSING  ${handle}`);
      continue;
    }
    matched++;
    rollback.previous.push({
      id: String(doc._id),
      installerGuides: doc.installerGuides || [],
      manuals: doc.manuals || [],
    });

    if (APPLY) {
      await products.updateOne(
        { _id: doc._id },
        {
          $set: {
            installerGuides: INSTALLER_GUIDES,
            manuals: MANUALS,
            updatedAt: new Date(),
          },
        },
      );
    }
    console.log(
      `${APPLY ? "UPDATE" : "WOULD UPDATE"}  ${doc.name}  ` +
        `${INSTALLER_GUIDES.length} installer guide(s), ${MANUALS.length} manual(s)`,
    );
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run"}: ${matched}/${HANDLES.length} product(s).`);

  if (APPLY && rollback.previous.length) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-oscar-pergola-docs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written to ${path.basename(file)}`);
  }
  if (!APPLY) console.log("Re-run with --apply to write.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
