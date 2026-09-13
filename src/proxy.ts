import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/authCookies";

const authMiddleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isAuth = !!token;
    const isAdmin = token?.role === "admin";

    const isLoginPage = req.nextUrl.pathname.startsWith("/login");
    const isAdminPage = req.nextUrl.pathname.startsWith("/admin");

    // If accessing admin pages, check for admin role
    if (isAdminPage) {
      if (!isAuth) {
        return NextResponse.redirect(new URL("/login", req.url));
      }
      if (!isAdmin) {
        return NextResponse.redirect(new URL("/profile", req.url));
      }
    }

    // Redirect authenticated users away from login
    if (isLoginPage && isAuth) {
      if (isAdmin) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
      return NextResponse.redirect(new URL("/profile", req.url));
    }

    return NextResponse.next();
  },
  {
    /*
     * The session cookie is not called `next-auth.session-token`.
     *
     * authOptions renames it, and withAuth does not read authOptions — it has
     * its own getToken call, which defaults to the next-auth name. Without
     * this the middleware found no token on any request, so a signed-in admin
     * asking for /admin was redirected to the sign-in page, which redirected
     * back, and the login splash simply never went away.
     */
    cookies: {
      sessionToken: { name: SESSION_COOKIE_NAME },
    },
    /*
     * Send a refusal to the site's own login page. Left to itself withAuth
     * redirects to /api/auth/signin — next-auth's built-in page, which this
     * site does not use and which was what the loop above bounced through.
     */
    pages: {
      signIn: "/login",
    },
    callbacks: {
      authorized: ({ token, req }) => {
        const isPublicPage =
          req.nextUrl.pathname.startsWith("/login") ||
          req.nextUrl.pathname.startsWith("/register");
        return isPublicPage || !!token;
      },
    },
  },
);

export const proxy = authMiddleware;
export default authMiddleware;

export const config = {
  matcher: [
    "/admin/:path*",
    "/login",
    "/register",
    "/profile/:path*",
  ],
};
