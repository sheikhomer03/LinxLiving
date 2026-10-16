import { execSync } from "child_process";
import dns from "dns";
import mongoose from "mongoose";

function configureMongoDns(uri: string) {
  if (!uri.startsWith("mongodb+srv://")) return;

  const servers = (
    process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1,9.9.9.9"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (servers.length) {
    dns.setServers(servers);
  }
}

function parseSrvUri(uri: string) {
  const m = uri.match(
    /^mongodb\+srv:\/\/([^@]+)@([^/?]+)(\/[^?]*)?(\?.*)?$/i,
  );
  if (!m) return null;
  return {
    auth: m[1],
    host: m[2],
    dbPath: m[3] || "/",
    query: m[4] || "",
  };
}

function nslookupSrv(host: string): string[] {
  try {
    const out = execSync(`nslookup -type=SRV _mongodb._tcp.${host} 8.8.8.8`, {
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    const hosts: string[] = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/svr hostname\s*=\s*(\S+)/i);
      if (m) hosts.push(m[1].replace(/\.$/, ""));
    }
    return [...new Set(hosts)];
  } catch {
    return [];
  }
}

async function resolveShardHosts(clusterHost: string) {
  try {
    const records = await dns.promises.resolveSrv(
      `_mongodb._tcp.${clusterHost}`,
    );
    return records.map((r) => ({ host: r.name, port: r.port || 27017 }));
  } catch {
    const names = nslookupSrv(clusterHost);
    return names.map((h) => ({ host: h, port: 27017 }));
  }
}

function buildShardUri(
  parsed: NonNullable<ReturnType<typeof parseSrvUri>>,
  shards: { host: string; port: number }[],
) {
  const hostList = shards.map((s) => `${s.host}:${s.port}`).join(",");
  const q = new URLSearchParams(String(parsed.query || "").replace(/^\?/, ""));
  q.delete("replicaSet");
  if (!q.has("ssl") && !q.has("tls")) q.set("tls", "true");
  if (!q.has("authSource")) q.set("authSource", "admin");
  q.set("retryWrites", q.get("retryWrites") || "true");
  return `mongodb://${parsed.auth}@${hostList}${parsed.dbPath}?${q.toString()}`;
}

async function connectWithSrvFallback(
  uri: string,
  opts: mongoose.ConnectOptions,
) {
  try {
    return await mongoose.connect(uri, {
      ...opts,
      serverSelectionTimeoutMS: opts.serverSelectionTimeoutMS ?? 25000,
    });
  } catch (firstErr) {
    const parsed = parseSrvUri(uri);
    if (!parsed) throw firstErr;

    const shards = await resolveShardHosts(parsed.host);
    if (!shards.length) throw firstErr;

    const fallback = buildShardUri(parsed, shards);
    const code =
      firstErr && typeof firstErr === "object" && "code" in firstErr
        ? String((firstErr as { code?: unknown }).code)
        : firstErr instanceof Error
          ? firstErr.message
          : "unknown";
    console.warn(
      `mongodb+srv failed (${code}); trying ${shards.length} shard hosts…`,
    );
    return mongoose.connect(fallback, {
      ...opts,
      serverSelectionTimeoutMS: 45000,
    });
  }
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error(
      "Please define the MONGODB_URI environment variable inside .env.local",
    );
  }

  configureMongoDns(MONGODB_URI);

  if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
      /*
       * The pool, sized for Vercel rather than for a long-lived server.
       *
       * A pool spares the next request the TCP + TLS + auth handshake, but
       * every warm serverless instance keeps its own, and they all count
       * against the cluster's allowance — 500 on an M0, which Atlas has now
       * refused connections on twice.
       *
       * maxPoolSize 3  – a page's reads run in parallel but in single
       *                  figures, and an instance under real load queues for
       *                  a moment rather than opening a fourth. Was 10, then
       *                  5; Atlas alerted again at 5, and every instance the
       *                  platform keeps warm multiplies whatever this is.
       * minPoolSize 0  – was 2, which was the worse half of the problem: two
       *                  sockets per instance that were never released no
       *                  matter how idle it went, so the floor rose with
       *                  every instance the platform kept warm.
       * maxIdleTimeMS  – an instance that has gone quiet hands its sockets
       *                  back after a minute instead of holding them until
       *                  it is recycled.
       * socketTimeoutMS – close idle sockets after 45 s; Vercel functions can
       *                   sleep for up to 50 s, so this keeps them from being
       *                   torn down mid-sleep.
       * serverSelectionTimeoutMS – how long to wait for a primary; 10 s is
       *                            enough on a healthy Atlas cluster and
       *                            surfaces a real outage quickly.
       */
      maxPoolSize: 3,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000,
    };

    cached.promise = connectWithSrvFallback(MONGODB_URI, opts);
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectDB;
