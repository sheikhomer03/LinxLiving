import { unstable_cache as nextUnstableCache } from "next/cache";

const inFlight = new Map<string, Promise<unknown>>();

/**
 * `unstable_cache`, except that identical cache misses share one read.
 *
 * Next does not coordinate misses: when an entry expires, every request that
 * arrives before the first one finishes runs the whole read itself. With the
 * connection pool at 3 they then queue behind each other. Ten pages opened
 * together on an empty cache made 931 queries and took 149 s, measured
 * 2026-11-05. Shared per server instance, for the length of the read only.
 *
 * Keeps the callback's own text, which Next uses as part of the cache key, so
 * every entry keeps the key it had.
 */
export const unstable_cache: typeof nextUnstableCache = (fn, keyParts, options) => {
  const source = fn.toString();
  const shared = ((...args: unknown[]) => {
    const key = JSON.stringify([source, keyParts, args]);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => (fn as (...a: unknown[]) => Promise<unknown>)(...args))
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }) as unknown as typeof fn;
  shared.toString = () => source;
  return nextUnstableCache(shared, keyParts, options);
};
