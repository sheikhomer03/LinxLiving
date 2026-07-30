require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const before = await db.collection("brands").findOne({ slug: "linx-living" });
  if (!before) {
    console.log(JSON.stringify({ error: "Brand linx-living not found" }));
    process.exit(1);
  }
  const clash = await db.collection("brands").findOne({ slug: "spectra" });
  if (clash) {
    console.log(
      JSON.stringify({
        error: "slug spectra already exists",
        id: String(clash._id),
      }),
    );
    process.exit(1);
  }

  await db.collection("brands").updateOne(
    { _id: before._id },
    {
      $set: {
        name: "Spectra",
        slug: "spectra",
        updatedAt: new Date(),
        shopifySyncedAt: null,
      },
    },
  );

  const after = await db.collection("brands").findOne({ _id: before._id });
  const productCount = await db
    .collection("products")
    .countDocuments({ brand: before._id });

  console.log(
    JSON.stringify(
      {
        before: {
          name: before.name,
          slug: before.slug,
          id: String(before._id),
        },
        after: {
          name: after.name,
          slug: after.slug,
          id: String(after._id),
        },
        productsLinked: productCount,
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
