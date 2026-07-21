/**
 * Cross-tab / same-tab catalog sync.
 * Admin mutations call notifyCatalogChange(); storefront listens and refreshes once.
 */

export type CatalogScope =
  | "brands"
  | "menus"
  | "products"
  | "collections"
  | "all";

export type CatalogChangeDetail = {
  scope: CatalogScope;
  at: number;
};

const CHANNEL = "linx-catalog-sync";
const STORAGE_KEY = "linx-catalog-sync";
const EVENT = "linx:catalog-change";

function canUseWindow() {
  return typeof window !== "undefined";
}

export function notifyCatalogChange(scope: CatalogScope = "all") {
  if (!canUseWindow()) return;

  const detail: CatalogChangeDetail = { scope, at: Date.now() };

  window.dispatchEvent(new CustomEvent(EVENT, { detail }));

  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage(detail);
    bc.close();
  } catch {
    // BroadcastChannel unsupported — fall through to storage
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // ignore quota / private mode
  }
}

export function subscribeCatalogChange(
  onChange: (detail: CatalogChangeDetail) => void,
  scopes?: CatalogScope[],
) {
  if (!canUseWindow()) return () => {};

  const matches = (scope: CatalogScope) => {
    if (!scopes?.length) return true;
    return scopes.includes(scope) || scope === "all" || scopes.includes("all");
  };

  const handleDetail = (detail: CatalogChangeDetail | null) => {
    if (!detail?.scope) return;
    if (!matches(detail.scope)) return;
    onChange(detail);
  };

  const onLocal = (e: Event) => {
    handleDetail((e as CustomEvent<CatalogChangeDetail>).detail);
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      handleDetail(JSON.parse(e.newValue) as CatalogChangeDetail);
    } catch {
      // ignore
    }
  };

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => handleDetail(e.data as CatalogChangeDetail);
  } catch {
    bc = null;
  }

  window.addEventListener(EVENT, onLocal);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
    bc?.close();
  };
}
