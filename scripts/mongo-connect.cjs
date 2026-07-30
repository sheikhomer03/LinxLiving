/**
 * Connect to Mongo even when mongodb+srv TXT lookup times out.
 * Falls back to known Atlas shard hosts from SRV (or nslookup).
 */
const dns = require("dns");
const { execSync } = require("child_process");
const mongoose = require("mongoose");

function applyDns() {
  const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1,9.9.9.9")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

function parseSrvUri(uri) {
  const m = String(uri || "").match(
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

function nslookupSrv(host) {
  try {
    const out = execSync(
      `nslookup -type=SRV _mongodb._tcp.${host} 8.8.8.8`,
      { encoding: "utf8", timeout: 20000, windowsHide: true },
    );
    const hosts = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/svr hostname\s*=\s*(\S+)/i);
      if (m) hosts.push(m[1].replace(/\.$/, ""));
    }
    return [...new Set(hosts)];
  } catch {
    return [];
  }
}

async function resolveShardHosts(clusterHost) {
  try {
    const records = await dns.promises.resolveSrv(`_mongodb._tcp.${clusterHost}`);
    return records.map((r) => ({ host: r.name, port: r.port || 27017 }));
  } catch {
    const names = nslookupSrv(clusterHost);
    return names.map((h) => ({ host: h, port: 27017 }));
  }
}

async function connectMongo(uri = process.env.MONGODB_URI) {
  applyDns();
  if (!uri) throw new Error("Missing MONGODB_URI");

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
    return mongoose.connection;
  } catch (firstErr) {
    const parsed = parseSrvUri(uri);
    if (!parsed) throw firstErr;

    const shards = await resolveShardHosts(parsed.host);
    if (!shards.length) throw firstErr;

    const hostList = shards.map((s) => `${s.host}:${s.port}`).join(",");
    // Drop srv-only params; force TLS + authSource for Atlas
    const q = new URLSearchParams(
      String(parsed.query || "").replace(/^\?/, ""),
    );
    q.delete("replicaSet");
    if (!q.has("ssl") && !q.has("tls")) q.set("tls", "true");
    if (!q.has("authSource")) q.set("authSource", "admin");
    q.set("retryWrites", q.get("retryWrites") || "true");

    const fallback = `mongodb://${parsed.auth}@${hostList}${parsed.dbPath}?${q.toString()}`;
    console.warn(
      `mongodb+srv failed (${firstErr.code || firstErr.message}); trying ${shards.length} shard hosts…`,
    );
    await mongoose.connect(fallback, { serverSelectionTimeoutMS: 45000 });
    return mongoose.connection;
  }
}

module.exports = { connectMongo, applyDns };
