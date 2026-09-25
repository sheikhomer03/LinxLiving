require("tsx/cjs");
const child_process = require("child_process");

async function main() {
  const html = child_process.execSync("curl -s https://tilesporcelain.co.uk/epoxy-grout-and-glitter").toString();
  // find configurable options
  const match = html.match(/spConfig":\s*(\{.*?\})\s*,\s*"gallerySwitchStrategy"/);
  if (match) {
    const config = JSON.parse(match[1]);
    console.log(JSON.stringify(config.attributes, null, 2));
  } else {
    console.log("No configurable options found in JSON.");
  }
}
main().catch(console.error);
