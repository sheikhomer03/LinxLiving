import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { SESSION_COOKIE_NAME } from "@/lib/authCookies";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        await connectDB();

        const user = await User.findOne({ email: credentials.email });

        if (!user || !user.password) {
          throw new Error("User not found");
        }

        const isPasswordCorrect = await bcrypt.compare(
          credentials.password,
          user.password,
        );

        if (!isPasswordCorrect) {
          throw new Error("Invalid password");
        }

        /*
         * An unapproved trade application cannot sign in.
         *
         * Checked after the password so this never becomes an oracle for which
         * addresses have applied. "pending" and "rejected" are both refused:
         * letting a pending applicant in would give them an account with no
         * trade pricing on it, which reads as a broken discount rather than as
         * a decision still being made. Ordinary shoppers are "none" and are
         * unaffected — which is every account that existed before this.
         */
        if (user.tradeStatus === "pending") {
          throw new Error(
            "Your trade account is awaiting approval. We will email you as soon as it is reviewed.",
          );
        }
        if (user.tradeStatus === "rejected") {
          throw new Error(
            "This trade application was not approved. Please contact us if you think this is a mistake.",
          );
        }

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          isTradeAccount: Boolean(user.isTradeAccount),
          tradeDepartments: Array.isArray(user.tradeDepartments)
            ? user.tradeDepartments.map((d: unknown) => String(d))
            : [],
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as any).role;
        token.id = user.id;
        token.isTradeAccount = (user as any).isTradeAccount ?? false;
        token.tradeDepartments = (user as any).tradeDepartments ?? [];
      }

      // Handle session update on the client
      if (trigger === "update" && session) {
        if (session.name) token.name = session.name;
        if (session.email) token.email = session.email;
        if (session.role) token.role = session.role;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
        (session.user as any).isTradeAccount = token.isTradeAccount ?? false;
        (session.user as any).tradeDepartments = token.tradeDepartments ?? [];
        session.user.name = token.name;
        session.user.email = token.email!;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  /*
   * A cookie name of our own, rather than NextAuth's default.
   *
   * Cookies are scoped by host and ignore the port, so every app served from
   * localhost shares one jar. A sibling project on another port also runs
   * NextAuth v4 with the default `next-auth.session-token` and its own secret,
   * so whichever app logged in last overwrote the other's cookie and the next
   * request failed with `JWT_SESSION_ERROR: decryption operation failed` —
   * the token was real, just encrypted for a different application.
   *
   * The name only needs to be distinct; the `__Secure-` prefix is added in
   * production, where the cookie must also be Secure to carry it.
   */
  cookies: {
    sessionToken: {
      // Shared with the middleware, which has to read the same cookie.
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
