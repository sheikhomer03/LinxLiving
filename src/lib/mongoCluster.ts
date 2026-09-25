/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Two MongoDB clusters, one application.
 *
 * The primary holds the catalogue the site started with. The secondary exists
 * because the primary is at its storage ceiling, and takes whole brands plus
 * everything created from now on. Nothing is split down the middle: a brand
 * and all of its products live together in one cluster, which is what makes
 * routing a single lookup rather than a per-document decision.
 *
 * Where a brand lives is recorded on the brand document itself, and brands
 * always live in the primary. That keeps one authoritative registry — asking
 * "which cluster?" never has to ask both.
 *
 * Models are registered from the same schemas on both connections, so
 * `Product` means the same shape either side.
 */
import mongoose, {
  type Connection,
  type Model,
  type PipelineStage,
} from "mongoose";
import connectDB from "@/lib/mongodb";

export type ClusterKey = "primary" | "secondary";

/** Value stored on `Brand.dataCluster`. Absent means primary. */
export const DEFAULT_CLUSTER: ClusterKey = "primary";

/** New brands, coupons and collections are created here. */
export const NEW_DATA_CLUSTER: ClusterKey = "secondary";

type Cache = { conn: Connection | null; promise: Promise<Connection> | null };

declare global {
  var __mongoSecondary: Cache | undefined;
}

let cached = global.__mongoSecondary;
if (!cached) cached = global.__mongoSecondary = { conn: null, promise: null };

/**
 * The secondary connection, opened once per process.
 *
 * Uses the same DNS servers the primary needs: this machine's resolver times
 * out on Atlas SRV lookups, and `mongodb.ts` sets them globally, so importing
 * that first is load-bearing rather than incidental.
 */
export async function secondaryConnection(): Promise<Connection> {
  const uri = process.env.MONGODB_URL2;
  if (!uri) {
    throw new Error(
      "MONGODB_URL2 is not set — the secondary cluster cannot be reached.",
    );
  }

  if (!cached) cached = global.__mongoSecondary = { conn: null, promise: null };
  if (cached.conn && cached.conn.readyState === 1) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .createConnection(uri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 30000,
      })
      .asPromise();
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}

/** The primary connection — the one the rest of the app already uses. */
export async function primaryConnection(): Promise<Connection> {
  await connectDB();
  return mongoose.connection;
}

export async function connectionFor(key: ClusterKey): Promise<Connection> {
  return key === "secondary" ? secondaryConnection() : primaryConnection();
}

/**
 * The same model on whichever cluster is asked for.
 *
 * Schemas are taken from the already-registered primary models rather than
 * re-declared, so the two sides cannot drift apart as fields are added.
 */
export async function modelFor<T = any>(
  key: ClusterKey,
  name: string,
): Promise<Model<T>> {
  if (key === "primary") {
    return (await primaryModel(name)) as Model<T>;
  }

  const conn = await secondaryConnection();
  const existing = conn.models[name];
  if (existing) return existing as Model<T>;

  const primary = await primaryModel(name);
  return conn.model<T>(name, primary.schema);
}

/**
 * The primary-connection model, importing its module if nothing has yet.
 *
 * A model only registers itself as a side effect of its file being imported,
 * and a caller asking this module for `User` has no reason to have imported
 * `@/models/User`. Loading on demand means routing never depends on which
 * files happened to be pulled in first.
 */
async function primaryModel(name: string): Promise<Model<any>> {
  await connectDB();
  if (mongoose.models[name]) return mongoose.models[name] as Model<any>;

  const loader = MODEL_MODULES[name];
  if (!loader) {
    throw new Error(
      "no loader for model " + name + " — add it to MODEL_MODULES",
    );
  }
  await loader();

  const m = mongoose.models[name];
  if (!m) throw new Error("model did not register itself: " + name);
  return m as Model<any>;
}

/**
 * Static imports, so the bundler can see them — a computed `import()` on a
 * path built at runtime resolves to nothing under webpack.
 */
const MODEL_MODULES: Record<string, () => Promise<unknown>> = {
  Address: () => import("@/models/Address"),
  Brand: () => import("@/models/Brand"),
  Collection: () => import("@/models/Collection"),
  ContactQuery: () => import("@/models/ContactQuery"),
  Coupon: () => import("@/models/Coupon"),
  Department: () => import("@/models/Department"),
  Menu: () => import("@/models/Menu"),
  Order: () => import("@/models/Order"),
  Product: () => import("@/models/Product"),
  ProductSupplier: () => import("@/models/ProductSupplier"),
  PurchaseOrder: () => import("@/models/PurchaseOrder"),
  Review: () => import("@/models/Review"),
  Settings: () => import("@/models/Settings"),
  Subscriber: () => import("@/models/Subscriber"),
  Supplier: () => import("@/models/Supplier"),
  SupplierSyncLog: () => import("@/models/SupplierSyncLog"),
  User: () => import("@/models/User"),
  Wishlist: () => import("@/models/Wishlist"),
};

/** Both copies of a model, for the read paths that have to ask each cluster. */
export async function modelsForAll<T = any>(
  name: string,
): Promise<{ key: ClusterKey; model: Model<T> }[]> {
  const out: { key: ClusterKey; model: Model<T> }[] = [
    { key: "primary", model: await modelFor<T>("primary", name) },
  ];
  if (isSecondaryConfigured()) {
    try {
      out.push({ key: "secondary", model: await modelFor<T>("secondary", name) });
    } catch (e) {
      // A cluster that will not connect must not take the page down with it —
      // the primary's results are still a valid, if partial, answer.
      console.error("secondary cluster unavailable:", (e as Error).message);
    }
  }
  return out;
}

export function isSecondaryConfigured(): boolean {
  return Boolean(process.env.MONGODB_URL2?.trim());
}

/* ------------------------------------------------------------------ *
 * Brand registry
 * ------------------------------------------------------------------ */

type BrandRoute = { id: string; slug: string; cluster: ClusterKey };

let routeCache: { at: number; rows: BrandRoute[] } | null = null;
const ROUTE_TTL_MS = 60_000;

/**
 * Which cluster each brand's products live in.
 *
 * Brands themselves always sit in the primary, so this is one query against
 * one place. Cached briefly: it is read on nearly every product operation and
 * changes only when a brand is migrated.
 */
export async function brandRoutes(): Promise<BrandRoute[]> {
  const now = Date.now();
  if (routeCache && now - routeCache.at < ROUTE_TTL_MS) return routeCache.rows;

  await connectDB();
  const { Brand } = await import("@/models/Brand");
  const rows = (await Brand.find({})
    .select("_id slug dataCluster")
    .lean()) as Array<{ _id: unknown; slug?: string; dataCluster?: string }>;

  const mapped: BrandRoute[] = rows.map((b) => ({
    id: String(b._id),
    slug: String(b.slug || ""),
    cluster: b.dataCluster === "secondary" ? "secondary" : DEFAULT_CLUSTER,
  }));
  routeCache = { at: now, rows: mapped };
  return mapped;
}

/** Drop the cache — call after migrating a brand or creating one. */
export function invalidateBrandRoutes(): void {
  routeCache = null;
}

/** Which cluster holds this brand's products. Unknown brands use the default. */
export async function clusterForBrand(
  brandId: unknown,
): Promise<ClusterKey> {
  if (!brandId) return DEFAULT_CLUSTER;
  const id = String((brandId as { _id?: unknown })?._id ?? brandId);
  const routes = await brandRoutes();
  return routes.find((r) => r.id === id)?.cluster ?? DEFAULT_CLUSTER;
}

export async function clusterForBrandSlug(slug: string): Promise<ClusterKey> {
  if (!slug) return DEFAULT_CLUSTER;
  const routes = await brandRoutes();
  const s = String(slug).trim().toLowerCase();
  return routes.find((r) => r.slug === s)?.cluster ?? DEFAULT_CLUSTER;
}

/** Brand ids held by one cluster — for scoping a query to that side. */
export async function brandIdsIn(key: ClusterKey): Promise<string[]> {
  return (await brandRoutes()).filter((r) => r.cluster === key).map((r) => r.id);
}

/**
 * Find which cluster holds a product, given only its id.
 *
 * Update and delete are handed an id and nothing else, and the id alone says
 * nothing about where the document lives. The brand registry cannot answer
 * either, because reading the brand means reading the product first. So this
 * asks the primary and, only if that misses, the secondary — the common case
 * costs one indexed `_id` lookup.
 */
export async function locateProduct(id: string) {
  return locateProductBy({ _id: id });
}

/**
 * The same search, for callers holding something other than an `_id` —
 * Shopify webhooks arrive with a `shopifyProductId` and nothing else.
 *
 * The filter should match at most one product; the first cluster to answer
 * wins. Give it something indexed: this runs on every inbound webhook.
 */
export async function locateProductBy(
  filter: Record<string, unknown>,
): Promise<{ cluster: ClusterKey; model: Model<any> } | null> {
  const order: ClusterKey[] = isSecondaryConfigured()
    ? ["primary", "secondary"]
    : ["primary"];

  for (const key of order) {
    try {
      const model = await modelFor(key, "Product");
      const hit = await model.exists(filter);
      if (hit) return { cluster: key, model };
    } catch (e) {
      // A cluster that cannot be reached is not the same as a miss: say so
      // rather than silently reporting the product as absent.
      console.error(
        "cluster " + key + " unreachable while locating product:",
        (e as Error).message,
      );
    }
  }
  return null;
}

/**
 * Move one product to the cluster its brand lives in, if it is not there.
 *
 * Reassigning a product's brand — in the admin form, or by changing the
 * vendor in Shopify — can hand it to a brand whose catalogue sits on the
 * other cluster. Left alone the document becomes invisible to every
 * brand-scoped query, so it has to follow its brand.
 *
 * Copy first and delete only once the copy is confirmed: an interrupted move
 * leaves a duplicate, which is recoverable, rather than nothing, which is not.
 * The `_id` is preserved because orders, wishlists and `relatedProductIds`
 * all reference it.
 */
export async function reconcileProductCluster(
  id: string,
  brandId: unknown,
  from: ClusterKey,
): Promise<ClusterKey> {
  const target = await clusterForBrand(brandId);
  if (target === from) return from;

  const source = await modelFor(from, "Product");
  const doc = await source.findById(id).lean();
  if (!doc) return from;

  const dest = await modelFor(target, "Product");
  await dest.replaceOne({ _id: id }, doc, { upsert: true });

  if (!(await dest.exists({ _id: id }))) {
    console.error(
      "product " + id + " failed to reach cluster " + target +
        " — left in place on " + from,
    );
    return from;
  }

  await source.deleteOne({ _id: id });
  return target;
}

/** The Product model for whichever cluster a brand's catalogue lives in. */
export async function productModelForBrand(
  brandId: unknown,
): Promise<{ cluster: ClusterKey; model: Model<any> }> {
  const cluster = await clusterForBrand(brandId);
  return { cluster, model: await modelFor(cluster, "Product") };
}

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

/**
 * Orders live wholly in the secondary, whichever cluster their products
 * came from.
 *
 * Splitting them by brand was the obvious idea and the wrong one: a basket
 * can hold products from both sides, and an order that existed in two halves
 * would have no single total, no single status and no way to paginate the
 * admin list. Keeping every order in one place means the twenty-odd query
 * sites stay ordinary single-cluster queries.
 *
 * The secondary is the side with room, and orders are the collection that
 * grows without limit.
 */
export const ORDERS_CLUSTER: ClusterKey = "secondary";

export async function ordersCluster(): Promise<ClusterKey> {
  return isSecondaryConfigured() ? ORDERS_CLUSTER : "primary";
}

/**
 * The Order model, on the cluster that holds orders.
 *
 * Falls back to the primary when no secondary is configured, so a deployment
 * without MONGODB_URL2 behaves exactly as it did before.
 */
export async function orderModel<T = any>(): Promise<Model<T>> {
  return modelFor<T>(await ordersCluster(), "Order");
}

/**
 * Orders reference users, and users live in the primary — `populate` cannot
 * reach across a connection, so the join has to be done by hand.
 */
export async function usersForOrders(
  ids: unknown[],
  select = "name email",
): Promise<Map<string, any>> {
  const wanted = [...new Set(ids.filter(Boolean).map(String))];
  if (!wanted.length) return new Map();
  const User = await modelFor("primary", "User");
  const rows = await User.find({ _id: { $in: wanted } })
    .select(select)
    .lean();
  return new Map(rows.map((u: any) => [String(u._id), u]));
}

/* ------------------------------------------------------------------ *
 * Federated reads
 * ------------------------------------------------------------------ */

type SortSpec = Record<string, 1 | -1 | number>;

/**
 * Compare two documents the way MongoDB would for a given sort.
 *
 * Merging two clusters' results means re-sorting them together in memory,
 * and that ordering has to match what each side was sorted by or the merge
 * reshuffles the page. Missing values sort low, as they do in MongoDB.
 */
function comparatorFor(sort: SortSpec) {
  const keys = Object.entries(sort);
  return (a: any, b: any) => {
    for (const [field, dir] of keys) {
      const av = a?.[field];
      const bv = b?.[field];
      if (av === bv) continue;
      if (av == null) return dir >= 0 ? -1 : 1;
      if (bv == null) return dir >= 0 ? 1 : -1;
      let d: number;
      if (typeof av === "number" && typeof bv === "number") d = av - bv;
      else if (av instanceof Date && bv instanceof Date)
        d = av.getTime() - bv.getTime();
      else d = String(av).localeCompare(String(bv));
      if (d !== 0) return dir >= 0 ? d : -d;
    }
    // A stable tie-break, so the same page does not reorder between requests.
    return String(a?._id ?? "").localeCompare(String(b?._id ?? ""));
  };
}

/**
 * Run one query against every cluster in parallel and merge the results.
 *
 * `build` is handed a model and the number of documents to take, and must
 * apply that as its limit and apply **no skip**: a page starting at 40 can
 * be made up of documents 0-39 from one cluster, so each side has to offer
 * its first `skip + limit` before the merge can pick the right window.
 *
 * With no secondary configured this is one query and one array — the same
 * work the single-cluster code did.
 */
export async function fedFind<T = any>(
  build: (model: Model<any>, take: number | null) => Promise<T[]>,
  opts: { sort?: SortSpec; skip?: number; limit?: number | null } = {},
): Promise<T[]> {
  const models = await modelsForAll("Product");
  const skip = Math.max(0, opts.skip ?? 0);
  const limit = opts.limit ?? null;
  const take = limit == null ? null : skip + limit;

  if (models.length === 1) {
    const rows = await build(models[0].model, take);
    return limit == null ? rows : rows.slice(skip, skip + limit);
  }

  const pages = await Promise.all(
    models.map(({ key, model }) =>
      build(model, take).catch((e) => {
        // One unreachable cluster should degrade the listing, not empty it.
        console.error("fedFind failed on " + key + ":", (e as Error).message);
        return [] as T[];
      }),
    ),
  );

  let merged = pages.flat();
  if (opts.sort && Object.keys(opts.sort).length) {
    merged = merged.sort(comparatorFor(opts.sort));
  }
  return limit == null ? merged.slice(skip) : merged.slice(skip, skip + limit);
}

/**
 * Total across clusters.
 *
 * A capped count (`{ limit: n }`, used where the caller only needs to know
 * whether there are at least n matches) is capped again after summing: each
 * side would otherwise contribute up to n of its own and report 2n.
 */
export async function fedCount(
  filter: Record<string, unknown>,
  options?: { limit?: number },
): Promise<number> {
  const models = await modelsForAll("Product");
  const counts = await Promise.all(
    models.map(({ key, model }) =>
      model
        .countDocuments(filter, options)
        .exec()
        .catch((e: Error) => {
          console.error("fedCount failed on " + key + ":", e.message);
          return 0;
        }),
    ),
  );
  const total = counts.reduce((a, b) => a + b, 0);
  return options?.limit != null ? Math.min(options.limit, total) : total;
}

/** Union of a distinct field across clusters. */
export async function fedDistinct<T = unknown>(
  field: string,
  filter: Record<string, unknown> = {},
): Promise<T[]> {
  const models = await modelsForAll("Product");
  const lists = await Promise.all(
    models.map(({ key, model }) =>
      model
        .distinct(field, filter)
        .exec()
        .catch((e: Error) => {
          console.error("fedDistinct failed on " + key + ":", e.message);
          return [] as T[];
        }),
    ),
  );
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of lists.flat() as T[]) {
    const k = String(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * A `$group` pipeline that produces `{ _id, count }`, summed across clusters.
 *
 * Facet counts are the only aggregation the storefront runs per cluster, and
 * they all have this shape — two partial tallies add up to the real one.
 */
export async function fedGroupCount<T extends { _id: any; count: number }>(
  pipeline: PipelineStage[],
): Promise<T[]> {
  const models = await modelsForAll("Product");
  const results = await Promise.all(
    models.map(({ key, model }) =>
      model
        .aggregate<T>(pipeline, { allowDiskUse: true })
        .catch((e: Error) => {
          console.error("fedGroupCount failed on " + key + ":", e.message);
          return [] as T[];
        }),
    ),
  );
  const totals = new Map<string, T>();
  for (const row of results.flat()) {
    // `_id` is a composite object in some facets, so it cannot be keyed by
    // String() — every group would collapse into "[object Object]".
    const k = groupKey(row._id);
    const hit = totals.get(k);
    if (hit) hit.count += row.count;
    else totals.set(k, { ...row });
  }
  return [...totals.values()];
}

function groupKey(id: unknown): string {
  return id !== null && typeof id === "object" ? JSON.stringify(id) : String(id);
}

/**
 * A `$group` producing `{ _id, min }`, reduced across clusters.
 *
 * "From" prices are a minimum, and the minimum of two partial minima is the
 * real one — unlike a count, which is summed.
 */
export async function fedGroupMin<T extends { _id: any; min: number }>(
  pipeline: PipelineStage[],
): Promise<T[]> {
  const rows = await fedAggregate<T>(pipeline);
  const best = new Map<string, T>();
  for (const row of rows) {
    const k = groupKey(row._id);
    const hit = best.get(k);
    if (!hit || row.min < hit.min) best.set(k, { ...row });
  }
  return [...best.values()];
}

/** Every cluster's rows for a pipeline the caller merges itself. */
export async function fedAggregate<T = any>(
  pipeline: PipelineStage[],
): Promise<T[]> {
  const models = await modelsForAll("Product");
  const results = await Promise.all(
    models.map(({ key, model }) =>
      model
        .aggregate<T>(pipeline, { allowDiskUse: true })
        .catch((e: Error) => {
          console.error("fedAggregate failed on " + key + ":", e.message);
          return [] as T[];
        }),
    ),
  );
  return results.flat();
}

/** One product by id, from whichever cluster holds it. */
export async function fedFindById<T = any>(
  id: string,
  shape: (model: Model<any>) => Promise<T | null>,
): Promise<T | null> {
  const held = await locateProduct(id);
  return held ? shape(held.model) : null;
}

/**
 * Fill in each document's `brand` from the primary.
 *
 * Brands live only in the primary — that is what makes the routing registry
 * single-valued — so `populate("brand")` on a secondary-cluster query
 * silently yields null. Federated listings do the join here instead.
 *
 * Documents are mutated in place and returned, matching what populate did
 * for the callers that render `product.brand.name`.
 */
export async function attachBrands<T extends Record<string, any>>(
  docs: T[],
  select = "name uiName slug",
): Promise<T[]> {
  // An unpopulated `brand` is an ObjectId — itself an object, and one that
  // answers `"_id" in b` with true because bson gives ObjectId an `_id`
  // getter returning itself. So the test is whether the value IS an id,
  // not whether it looks like a document.
  const ids = [
    ...new Set(
      docs
        .map((d) => d?.brand)
        .filter((b) => b && mongoose.isObjectIdOrHexString(b))
        .map(String),
    ),
  ];
  if (!ids.length) return docs;

  const Brand = await modelFor("primary", "Brand");
  const rows = await Brand.find({ _id: { $in: ids } })
    .select(select)
    .lean();
  const byId = new Map(rows.map((b: any) => [String(b._id), b]));

  for (const d of docs) {
    const key = d?.brand == null ? "" : String(d.brand);
    const hit = byId.get(key);
    if (hit) (d as Record<string, unknown>).brand = hit;
  }
  return docs;
}
