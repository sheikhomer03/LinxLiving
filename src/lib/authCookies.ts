/**
 * The name of the session cookie, in one place.
 *
 * It is not the next-auth default — `authOptions` renames it — and two
 * independent pieces of code have to agree on it: the auth handler that writes
 * it, and the `withAuth` middleware in proxy.ts that reads it. They did not.
 * The middleware was looking for `next-auth.session-token`, finding nothing on
 * every request, and redirecting an authenticated admin straight back to the
 * sign-in page, which is what made a successful login appear to hang.
 *
 * This module exists rather than exporting the constant from `lib/auth.ts`
 * because middleware runs on the edge runtime: importing `lib/auth.ts` there
 * would drag in mongoose and bcrypt, neither of which can run on it. Nothing
 * heavier than an environment read belongs in this file.
 */

/**
 * `__Secure-` is only legal over HTTPS, so the prefix follows the environment
 * the cookie was written in — exactly as `authOptions.cookies` does.
 */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Secure-linxliving.session-token"
    : "linxliving.session-token";
