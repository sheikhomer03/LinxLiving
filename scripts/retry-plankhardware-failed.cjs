/**
 * Retry Plankhardware imports that failed with HTTP 404 (stale variant URLs).
 * Resolves legacy handles to live product URLs, imports any missing products,
 * and marks stale handles done so RESUME skips them.
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const LOG = path.join(__dirname, "_tmp-plankhardware-import.log");
const CHECKPOINT = path.join(__dirname, "_tmp-plankhardware-progress.json");

const BASE = "https://plankhardware.com";
const ua =
  process.env.UA ||
  "Mozilla/5.0 (compatible; LinxLivingBot/1.0; +https://linxsquare.com)";

function baseSlug(handle) {
  let slug = String(handle).replace(/-\d{10,}$/, "").replace(/-120mm$/, "");
  for (const prefix of ["plank-hardware-handles-knobs-", "plank-hardware-hooks-"]) {
    if (slug.startsWith(prefix)) slug = slug.slice(prefix.length);
  }
  return slug;
}

function slugVariants(slug) {
  const out = new Set([slug]);
  const replacements = [
    [/-knob-/, "-cabinet-knob-"],
    [/-knob$/, "-cabinet-knob"],
    [/-hook-/, "-wall-door-hook-"],
    [/-hook$/, "-wall-door-hook"],
    [/single-t-handle/, "single-t-pull-handle"],
    [/t-bar-handle/, "t-bar-pull-handle"],
    [/d-bar-handle/, "d-bar-pull-handle"],
    [/button-knob/, "button-cabinet-knob"],
    [/button-hook/, "button-wall-door-hook"],
    [/circular-hook/, "circular-wall-hook"],
    [/round-hook/, "round-wall-door-hook"],
    [/square-hook/, "curved-hook"],
    [/heavyweight-knurled-handle/, "heavyweight-knurled-pull-handle"],
    [/edge-pull-handle/, "edge-pull"],
    [/grooved-button-hook/, "grooved-button-wall-door-hook"],
    [/solid-brass/, "brass"],
    [/tapered-top-hook-black/, "wall-door-hook-matte-black"],
    [/hoffman-tapered-top-hook-black/, "hoffman-wall-door-hook-matte-black"],
    [/levi-square-hook-black/, "levi-curved-hook-matte-black"],
    [/levi-square-hook-solid-brass/, "levi-curved-hook-brass"],
    [/humboldt-knurled-button-knob-black/, "kepler-knurled-button-cabinet-knob-matte-black"],
    [/humboldt-knurled-button-knob/, "kepler-knurled-button-cabinet-knob"],
    [/humboldt-knurled-button-hook-antique-brass/, "kepler-knurled-hook-cabinet-knob-antique-brass"],
    [/humboldt-knurled-button-hook-black/, "kepler-knurled-button-hook-matte-black"],
    [/humboldt-knurled-button-hook-brass/, "kepler-knurled-button-wall-door-hook-brass"],
    [/pullman-circular-hook-brass/, "pullman-circular-wall-hook-brass"],
    [/lovell-circular-hook-brass/, "lovell-circular-wall-hook-brass"],
    [/bezel-grooved-hook-brass/, "bezel-grooved-wall-door-hook-brass"],
    [/revill-knurled-button-knob-solid-brass/, "revill-knurled-button-cabinet-knob-brass"],
    [/judd-edge-pull-handle-brass/, "judd-edge-pull-antique-brass"],
  ];
  for (const [from, to] of replacements) {
    if (from.test(slug)) out.add(slug.replace(from, to));
  }
  return [...out].map((s) => s.replace(/--+/g, "-").replace(/-$/, ""));
}

async function resolveHandle(staleHandle) {
  const candidates = slugVariants(baseSlug(staleHandle));
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const candidate of candidates) {
      try {
        const res = await fetch(`${BASE}/products/${candidate}`, {
          redirect: "follow",
          headers: { "User-Agent": ua },
        });
        if (!res.ok) continue;
        const final = new URL(res.url).pathname.replace(/^\/products\//, "").replace(/\/$/, "");
        if (!final || final.includes("collections")) continue;
        return final;
      } catch {
        // try next candidate / attempt
      }
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  return "";
}

function parseFailedHandles() {
  const log = fs.readFileSync(LOG, "utf8");
  const handles = [];
  const seen = new Set();
  for (const m of log.matchAll(/✗ ([^:]+): HTTP 404/g)) {
    const h = String(m[1] || "").trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    handles.push(h);
  }
  return handles;
}

async function main() {
  const staleHandles = parseFailedHandles();
  if (!staleHandles.length) {
    console.log("No failed handles found in log.");
    return;
  }

  console.log(`Retrying ${staleHandles.length} failed stale handles…`);

  const saved = fs.existsSync(CHECKPOINT)
    ? JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"))
    : { done: [] };
  const done = new Set((saved.done || []).map(String));

  const resolved = [];
  const unresolved = [];
  for (const stale of staleHandles) {
    const handle = await resolveHandle(stale);
    if (handle) resolved.push({ stale, handle });
    else unresolved.push(stale);
    await new Promise((r) => setTimeout(r, 120));
  }

  const importScript = path.join(__dirname, "import-plankhardware.cjs");
  const toImport = [];
  for (const { stale, handle } of resolved) {
    done.add(stale);
    if (!done.has(handle)) toImport.push({ stale, handle });
  }

  console.log(`Resolved ${resolved.length}, unresolved ${unresolved.length}, new imports ${toImport.length}`);

  if (toImport.length) {
    const handles = toImport.map((x) => x.handle).join(",");
    const env = {
      ...process.env,
      DRY_RUN: "0",
      RESUME: "0",
      LIMIT: "0",
      CONCURRENCY: "1",
      SKIP_IMAGES: process.env.SKIP_IMAGES || "0",
      HANDLES: handles,
    };
    const { spawnSync } = require("child_process");
    const result = spawnSync(
      process.execPath,
      ["--require", path.join(__dirname, "mongo-dns.cjs"), importScript],
      { env, stdio: "inherit", cwd: path.join(__dirname, "..") },
    );
    if (result.status !== 0) process.exit(result.status || 1);
    for (const { handle } of toImport) done.add(handle);
  }

  for (const { stale, handle } of resolved) {
    if (handle) done.add(handle);
    done.add(stale);
  }

  fs.writeFileSync(
    CHECKPOINT,
    JSON.stringify(
      {
        done: [...done],
        at: new Date().toISOString(),
        failed: unresolved.length,
        unresolved,
      },
      null,
      2,
    ),
  );

  if (unresolved.length) {
    console.log("Still unresolved:");
    for (const h of unresolved) console.log(`  - ${h}`);
  }
  console.log("Retry complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
