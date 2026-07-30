/**
 * Repair Fakro menus corrupted when Sterlingbuild reused the same category slug.
 * - Restore "Pitched Roof Windows" to FAKRO
 * - Ensure "Accessories" exists under FAKRO "Blinds & Accessories"
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const { ObjectId } = require("mongodb");

const DRY = process.env.DRY_RUN === "1";

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const menus = db.collection("menus");
  const brands = db.collection("brands");

  const fakro = await brands.findOne({ slug: "fakro" });
  const sterling = await brands.findOne({ slug: "sterlingbuild" });
  if (!fakro || !sterling) throw new Error("Missing fakro or sterlingbuild brand");

  const pitchedId = ObjectId.createFromHexString("6a68f5b3ab3ec7bcb981451d");
  const pitched = await menus.findOne({ _id: pitchedId });
  if (!pitched) throw new Error("Pitched Roof Windows menu not found");

  const actions = [];

  if (String(pitched.brand) !== String(fakro._id)) {
    actions.push({
      action: "restore-pitched-brand",
      from: String(pitched.brand),
      to: String(fakro._id),
      name: pitched.name,
    });
    if (!DRY) {
      await menus.updateOne(
        { _id: pitchedId },
        { $set: { brand: fakro._id, updatedAt: new Date() } },
      );
    }
  }

  // Ensure Fakro children that belong under pitched still point at it
  const pitchedChildSlugs = [
    "centre-pivot",
    "top-hung",
    "high-pivot",
    "conservation",
    "balcony",
    "electric-solar",
    "electricals",
    "flashing-kits",
    "l-shape-combination",
    "light-tunnels",
  ];
  const needReparent = await menus
    .find({
      brand: fakro._id,
      slug: { $in: pitchedChildSlugs },
      parent: { $ne: pitchedId },
    })
    .project({ name: 1, slug: 1, parent: 1 })
    .toArray();
  if (needReparent.length) {
    actions.push({
      action: "reparent-pitched-children",
      count: needReparent.length,
      items: needReparent.map((m) => ({
        name: m.name,
        slug: m.slug,
        parent: m.parent ? String(m.parent) : null,
      })),
    });
    if (!DRY) {
      await menus.updateMany(
        {
          brand: fakro._id,
          slug: { $in: pitchedChildSlugs },
          parent: { $ne: pitchedId },
        },
        { $set: { parent: pitchedId, updatedAt: new Date() } },
      );
    }
  }

  const blindsParent = await menus.findOne({
    slug: "blinds-accessories",
    brand: fakro._id,
    parent: null,
  });
  if (!blindsParent) throw new Error("FAKRO Blinds & Accessories parent missing");

  let accessories = await menus.findOne({
    slug: "accessories",
    brand: fakro._id,
  });
  if (!accessories) {
    actions.push({
      action: "create-accessories-subcategory",
      parent: String(blindsParent._id),
    });
    if (!DRY) {
      const now = new Date();
      const r = await menus.insertOne({
        name: "Accessories",
        slug: "accessories",
        parent: blindsParent._id,
        brand: fakro._id,
        order: 1,
        isActive: true,
        image: "",
        createdAt: now,
        updatedAt: now,
      });
      accessories = { _id: r.insertedId };
    }
  } else if (String(accessories.parent) !== String(blindsParent._id)) {
    actions.push({
      action: "move-accessories-under-blinds",
      fromParent: accessories.parent ? String(accessories.parent) : null,
      toParent: String(blindsParent._id),
    });
    if (!DRY) {
      await menus.updateOne(
        { _id: accessories._id },
        { $set: { parent: blindsParent._id, updatedAt: new Date() } },
      );
    }
  } else {
    actions.push({ action: "accessories-already-ok", id: String(accessories._id) });
  }

  // Verify Sterling still has its own pitched menu
  const sterlingPitched = await menus
    .find({
      brand: sterling._id,
      slug: "pitched-roof-windows",
      parent: null,
    })
    .project({ _id: 1, name: 1, slug: 1 })
    .toArray();

  // After restore, Fakro pitched should not be in sterling list
  const fakroTops = await menus
    .find({ brand: fakro._id, parent: null })
    .project({ name: 1, slug: 1 })
    .sort({ order: 1, name: 1 })
    .toArray();

  const fakroBlindsChildren = await menus
    .find({ brand: fakro._id, parent: blindsParent._id })
    .project({ name: 1, slug: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        dryRun: DRY,
        actions,
        sterlingPitchedMenus: sterlingPitched.map((m) => ({
          id: String(m._id),
          name: m.name,
          slug: m.slug,
        })),
        fakroTopLevel: fakroTops.map((m) => ({
          id: String(m._id),
          name: m.name,
          slug: m.slug,
        })),
        fakroBlindsChildren: fakroBlindsChildren.map((m) => ({
          name: m.name,
          slug: m.slug,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
