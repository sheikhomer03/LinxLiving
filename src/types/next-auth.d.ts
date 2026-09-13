import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      /** Approved trade account — see lib/trade.ts. */
      isTradeAccount?: boolean;
      /**
       * Department slugs the trade discount is limited to. Empty (or absent)
       * on an approved account means every department.
       */
      tradeDepartments?: string[];
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: string;
    isTradeAccount?: boolean;
    tradeDepartments?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    isTradeAccount?: boolean;
    tradeDepartments?: string[];
  }
}
