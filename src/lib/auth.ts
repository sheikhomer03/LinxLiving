import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";

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

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          isTradeAccount: Boolean(user.isTradeAccount),
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
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-linxliving.session-token"
          : "linxliving.session-token",
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
