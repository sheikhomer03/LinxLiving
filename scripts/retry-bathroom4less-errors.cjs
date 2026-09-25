/**
 * Retry the "fetch-failed" records left in b4l-pdp.jsonl by
 * capture-bathroom4less.cjs (transient network errors during stage B),
 * re-fetching just those product pages and rewriting the file with the
 * merged/updated records.
 */
const fs = require("fs");
const path = require("path");

const DATA =
  process.env.B4L_DATA ||
  "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/bathroom4less";
const PDP_FILE = path.join(DATA, "b4l-pdp.jsonl");
const ORIGIN = "https://www.bathroom4less.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

function parseSpecifications(html) {
  const titleIdx = html.indexOf(">Specifications<");
  if (titleIdx === -1) return { groups: {}, rawText: "" };
  const contentIdx = html.indexOf("card__collapsible-content", titleIdx);
  if (contentIdx === -1) return { groups: {}, rawText: "" };
  const nextItemIdx = html.indexOf("product-block-list__item", contentIdx);
  const endIdx = nextItemIdx === -1 ? Math.min(html.length, contentIdx + 20000) : nextItemIdx;
  const segment = html.slice(contentIdx, endIdx);
  const groups = {};
  const h3Re = /<h3>([^<]+)<\/h3>([\s\S]*?)(?=<h3>|$)/g;
  let m;
  while ((m = h3Re.exec(segment))) {
    const groupTitle = clean(m[1]);
    const body = m[2];
    const pairs = {};
    const dtddRe = /<dt[^>]*>[\s\S]*?class="DescriptionList-item">([^<]*)<[\s\S]*?<dd[^>]*>[\s\S]*?class="DescriptionList-item">([^<]*)</g;
    let p;
    while ((p = dtddRe.exec(body))) {
      const label = clean(p[1]);
      const value = clean(p[2]);
      if (label) pairs[label] = value;
    }
    if (Object.keys(pairs).length) groups[groupTitle] = pairs;
  }
  const rawText = clean(segment.replace(/<[^>]+>/g, " "));
  return { groups, rawText };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (i + 1));
        continue;
      }
      return res;
    } catch {
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

async function pool(items, limit, worker) {
  let i = 0,
    active = 0,
    done = 0;
  return new Promise((resolve) => {
    if (!items.length) return resolve();
    const next = () => {
      if (i >= items.length && active === 0) return resolve();
      while (active < limit && i < items.length) {
        const item = items[i++];
        active++;
        Promise.resolve(worker(item))
          .catch((e) => console.error("err", e.message))
          .finally(() => {
            active--;
            done++;
            if (done % 20 === 0) console.log(`  ${done}/${items.length}`);
            next();
          });
      }
    };
    next();
  });
}

async function main() {
  const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
  const records = lines.map((l) => JSON.parse(l));
  const byId = new Map(records.map((r) => [r.id, r]));
  const failed = records.filter((r) => r.error);
  console.log(`retrying ${failed.length} failed records`);

  await pool(failed, 8, async (r) => {
    const url = `${ORIGIN}/products/${r.handle}`;
    const res = await get(url);
    if (!res || !res.ok) return; // leave as error
    const html = await res.text();
    const { groups, rawText } = parseSpecifications(html);
    const vatIncluded = /priced Inc\.?\s*VAT/i.test(html);
    const rec = byId.get(r.id);
    rec.specGroups = groups;
    rec.rawSpecsText = rawText;
    rec.vatIncluded = vatIncluded;
    rec.error = null;
    rec.scrapedAt = new Date().toISOString();
  });

  const stillFailed = [...byId.values()].filter((r) => r.error).length;
  console.log(`still failed after retry: ${stillFailed}`);

  const out = [...byId.values()].map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(PDP_FILE, out);
  console.log("rewrote", byId.size, "records");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
