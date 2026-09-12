/**
 * Inspect and fix up trade accounts while testing.
 *
 * Everything here is also doable through the UI except `make-admin`, which has
 * no screen — there is no way to promote the first administrator from inside
 * the app, so it has to happen here.
 *
 * Usage (the --require shim is what makes the Mongo SRV lookup resolve):
 *   node --require ./scripts/mongo-dns.cjs scripts/trade-accounts.cjs list
 *   node --require ./scripts/mongo-dns.cjs scripts/trade-accounts.cjs make-admin you@example.com
 *   node --require ./scripts/mongo-dns.cjs scripts/trade-accounts.cjs show trade@example.com
 *   node --require ./scripts/mongo-dns.cjs scripts/trade-accounts.cjs reset trade@example.com
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

const [, , command, arg] = process.argv;

function usage() {
  console.log(`
Commands:
  list                    admins, departments, and every trade application
  show <email>            one account's trade state in full
  make-admin <email>      promote an existing account to admin
  reset <email>           DELETE the account, so you can re-apply with the same email
  repair <email>          force an application back to "pending" (for a row written
                          before the schema reloaded, so tradeStatus was dropped)
`);
}

(async () => {
  // connectMongo resolves to the mongoose *connection*, not mongoose itself.
  const connection = await connectMongo();
  const db = connection.db;
  const users = db.collection("users");

  if (command === "list") {
    const admins = await users
      .find({ role: "admin" })
      .project({ email: 1, name: 1 })
      .toArray();
    console.log("\nADMINS");
    if (!admins.length) {
      console.log("  (none — run make-admin <email> before testing the approval screen)");
    } else {
      admins.forEach((a) => console.log(`  ${a.email}  ${a.name || ""}`));
    }

    const depts = await db
      .collection("departments")
      .find({ isActive: true })
      .project({ slug: 1, name: 1 })
      .sort({ order: 1, name: 1 })
      .toArray();
    console.log("\nACTIVE DEPARTMENTS (slug — the value stored on a trade account)");
    depts.forEach((d) => console.log(`  ${String(d.slug).padEnd(24)} ${d.name}`));

    const trade = await users
      .find({ tradeStatus: { $in: ["pending", "approved", "rejected"] } })
      .project({
        email: 1,
        tradeStatus: 1,
        tradeDepartments: 1,
        isTradeAccount: 1,
        tradeCompanyName: 1,
      })
      .toArray();
    console.log("\nTRADE APPLICATIONS");
    if (!trade.length) {
      console.log("  (none yet)");
    } else {
      trade.forEach((t) =>
        console.log(
          `  ${String(t.email).padEnd(32)} ${String(t.tradeStatus).padEnd(9)} ` +
            `isTradeAccount=${Boolean(t.isTradeAccount)}  ` +
            `departments=${(t.tradeDepartments || []).length ? t.tradeDepartments.join(",") : "ALL"}`,
        ),
      );
    }
    console.log("");
  } else if (command === "show") {
    if (!arg) return usage();
    const u = await users.findOne({ email: String(arg).toLowerCase() });
    if (!u) {
      console.log(`No account for ${arg}`);
    } else {
      console.log({
        email: u.email,
        name: u.name,
        role: u.role,
        isTradeAccount: Boolean(u.isTradeAccount),
        tradeStatus: u.tradeStatus || "none",
        tradeDepartments: u.tradeDepartments || [],
        tradeCompanyName: u.tradeCompanyName || "",
        tradePhone: u.tradePhone || "",
        tradeAppliedAt: u.tradeAppliedAt || null,
        tradeApprovedAt: u.tradeApprovedAt || null,
        tradeRejectedAt: u.tradeRejectedAt || null,
      });
    }
  } else if (command === "make-admin") {
    if (!arg) return usage();
    const res = await users.updateOne(
      { email: String(arg).toLowerCase() },
      { $set: { role: "admin" } },
    );
    console.log(
      res.matchedCount
        ? `${arg} is now an admin. Sign out and back in — the role is carried in the session token.`
        : `No account for ${arg}. Register at /register first.`,
    );
  } else if (command === "repair") {
    if (!arg) return usage();
    const res = await users.updateOne(
      { email: String(arg).toLowerCase() },
      {
        $set: { tradeStatus: "pending", isTradeAccount: false },
        // Only fill the ones a dropped write would have left missing.
        $setOnInsert: {},
      },
    );
    const doc = await users.findOne({ email: String(arg).toLowerCase() });
    if (!doc) {
      console.log(`No account for ${arg}.`);
    } else {
      if (!Array.isArray(doc.tradeDepartments)) {
        await users.updateOne({ _id: doc._id }, { $set: { tradeDepartments: [] } });
      }
      console.log(
        res.matchedCount
          ? `${arg} is now pending — it will show in Admin → Trade Accounts.`
          : `No account for ${arg}.`,
      );
    }
  } else if (command === "reset") {
    if (!arg) return usage();
    const res = await users.deleteOne({ email: String(arg).toLowerCase() });
    console.log(
      res.deletedCount
        ? `Deleted ${arg}. You can apply again with the same email.`
        : `No account for ${arg}.`,
    );
  } else {
    usage();
  }

  await connection.close();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
