/**
 * In-memory (+ sessionStorage) cache for Navbar department/brand trees.
 *
 * Many pages (contact, login, FAQ, etc.) render <Navbar /> without
 * initialDepartments / initialBrandMenus. Without a cache, each soft
 * navigation remounts Navbar empty and re-fetches — which looks like the
 * mega-menu "reloading". Persist the last good payload for the tab session.
 */

type NavCachePayload = {
  brands: any[];
  departments: any[];
  at: number;
};

const STORAGE_KEY = "linx-nav-trees-v3";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

let memory: NavCachePayload | null = null;

function canUseStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function isFresh(payload: NavCachePayload | null): payload is NavCachePayload {
  if (!payload) return false;
  if (!payload.at || Date.now() - payload.at > TTL_MS) return false;
  return Boolean(payload.brands?.length || payload.departments?.length);
}

function readStorage(): NavCachePayload | null {
  if (!canUseStorage()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavCachePayload;
    return isFresh(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readNavCache(): NavCachePayload | null {
  if (isFresh(memory)) return memory;
  const stored = readStorage();
  if (stored) {
    memory = stored;
    return stored;
  }
  return null;
}

export function writeNavCache(partial: {
  brands?: any[];
  departments?: any[];
}) {
  const prev = readNavCache();
  const next: NavCachePayload = {
    brands: partial.brands?.length ? partial.brands : prev?.brands || [],
    departments: partial.departments?.length
      ? partial.departments
      : prev?.departments || [],
    at: Date.now(),
  };
  memory = next;
  if (!canUseStorage()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode — memory cache still helps same-tab navigations
  }
}

export function clearNavCache() {
  memory = null;
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
