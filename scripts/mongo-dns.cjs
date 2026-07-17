const dns = require("dns");

const servers = process.env.MONGODB_DNS_SERVERS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (servers?.length) {
  dns.setServers(servers);
} else if (process.platform === "win32") {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
}
