import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

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
    "/checkout/:path*",
  ],
};
