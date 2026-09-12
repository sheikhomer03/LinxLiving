import { getServerSession } from "next-auth";
import connectDB from "@/lib/mongodb";
import { authOptions } from "@/lib/auth";
import { User } from "@/models/User";
import { NO_TRADE, type TradeScope } from "@/lib/trade";

/**
 * The shopper's trade scope, decided on the server.
 *
 * The account half is re-read from Mongo rather than taken from the request —
 * otherwise anyone could post `isTradeAccount` and take 5% off, and the
 * department list would be just as forgeable. `tradeModeOn` is accepted as
 * posted because the toggle needs no account and is open to everyone anyway;
 * that is the same trust level as the item prices already flowing into these
 * routes.
 *
 * Every checkout path must call this rather than working out eligibility
 * itself, so the figure charged always matches the figure the basket quoted.
 */
export async function resolveTradeScope(
  tradeModeOn: unknown,
): Promise<TradeScope> {
  const toggleOn = Boolean(tradeModeOn);

  let accountActive = false;
  let departments: string[] = [];

  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (userId) {
      await connectDB();
      const account = await User.findById(userId).select(
        "isTradeAccount tradeStatus tradeDepartments",
      );
      // Both are checked: `isTradeAccount` is only ever set by approval, but a
      // revoked account should stop being trade the moment its status changes
      // even if the flag were left behind by a hand-edited record.
      accountActive =
        Boolean(account?.isTradeAccount) && account?.tradeStatus === "approved";
      if (accountActive && Array.isArray(account?.tradeDepartments)) {
        departments = account.tradeDepartments
          .map((d: unknown) => String(d || "").trim().toLowerCase())
          .filter(Boolean);
      }
    }
  } catch (error) {
    // A failed lookup must not hand out a discount, and must not block the
    // checkout either — fall through to whatever the toggle allows.
    console.error("resolveTradeScope:", error);
  }

  if (toggleOn) return { active: true, departments: null };
  if (!accountActive) return NO_TRADE;
  return { active: true, departments: departments.length ? departments : null };
}
