/**
 * Authenticated session for flooringsales.co.uk.
 *
 * Trade prices and the PDP configurator are only rendered for logged-in
 * accounts, so the scrape needs a session. The site serves identified crawlers
 * and blocks browser-spoofing user agents, so keep the UA below.
 *
 * Credentials come from the environment — never commit them:
 *   FSL_USERNAME=... FSL_PASSWORD=...
 */
const BASE = "https://www.flooringsales.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxFslEnrich/1.0";

function createSession() {
  const jar = new Map();

  const remember = (res) => {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === "deleted" || value === "") jar.delete(name);
      else jar.set(name, value);
    }
  };

  const cookieHeader = () =>
    [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  const TIMEOUT_MS = Number(process.env.FSL_TIMEOUT_MS || 45000);

  async function request(url, init = {}) {
    // Node's fetch never times out; a throttled response would otherwise hang
    // a worker forever and stall the whole run.
    const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: {
        "User-Agent": UA,
        ...(jar.size ? { Cookie: cookieHeader() } : {}),
        ...(init.headers || {}),
      },
    });
    remember(res);
    return res;
  }

  /** Follow redirects while keeping cookies (fetch's own follow drops them). */
  async function get(url, init = {}, hops = 5) {
    let target = url;
    for (let i = 0; i < hops; i++) {
      const res = await request(target, init);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return res;
        target = loc.startsWith("http") ? loc : `${BASE}${loc}`;
        continue;
      }
      return res;
    }
    throw new Error(`too many redirects: ${url}`);
  }

  const isLoggedIn = () =>
    [...jar.keys()].some((k) => k.startsWith("wordpress_logged_in"));

  async function login(username, password) {
    if (!username || !password) {
      throw new Error("FSL_USERNAME / FSL_PASSWORD not set");
    }
    const page = await get("/my-account/");
    const html = await page.text();

    // The site uses Profile Builder, so submit its form fields verbatim
    // (CSRFToken-wppb and the wppb_* hidden inputs) rather than guessing.
    const formMatch =
      html.match(/<form[^>]*>[\s\S]*?wppb_login[\s\S]*?<\/form>/i) ||
      html.match(/<form[^>]*>[\s\S]*?<\/form>/i);
    const form = formMatch ? formMatch[0] : "";
    const body = new URLSearchParams();
    // Read each tag whole: name and value can appear in either order, and an
    // optional-group regex silently drops the value.
    for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
      const name = (tag.match(/\bname="([^"]+)"/i) || [])[1];
      if (!name || /^(log|pwd)$/i.test(name)) continue;
      const value = (tag.match(/\bvalue="([^"]*)"/i) || [])[1] ?? "";
      body.set(name, value);
    }
    body.set("log", username);
    body.set("pwd", password);
    body.set("rememberme", "forever");
    body.set("wppb_login", "true");
    if (!body.has("wp-submit")) body.set("wp-submit", "Log In");

    const action =
      (form.match(/<form[^>]*action="([^"]*)"/i) || [])[1] || `${BASE}/my-account/`;

    const res = await get(action || `${BASE}/my-account/`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${BASE}/my-account/`,
      },
    });
    await res.text();
    return isLoggedIn();
  }

  return { request, get, login, isLoggedIn, cookieHeader, UA };
}

module.exports = { createSession, BASE, UA };
