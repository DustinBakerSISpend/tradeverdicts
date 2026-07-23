#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function args(argv) {
  const output = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key}`);
    output[key.slice(2)] = value;
  }
  return output;
}
function assert(value, message) { if (!value) throw new Error(message); }
async function listFiles(root) {
  const result = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full); else result.push(full);
    }
  }
  await walk(root);
  return result;
}

const input = args(process.argv);
for (const key of ["trades-json", "players-json", "teams-json", "pages-dir"]) {
  if (!input[key]) throw new Error(`Missing --${key}`);
}
const [trades, players, teams] = await Promise.all([
  readFile(input["trades-json"], "utf8").then(JSON.parse),
  readFile(input["players-json"], "utf8").then(JSON.parse),
  readFile(input["teams-json"], "utf8").then(JSON.parse),
]);
const models = buildPrivateRouteModels({ trades, players, teams });
assert(models.counts.routeModels === 123, "Expected 123 route models.");
assert(models.counts.internalLinks === 434, "Expected 434 internal links.");
assert((await stat(input["pages-dir"])).isDirectory(), "NBA pages directory is missing.");

const files = (await listFiles(input["pages-dir"]))
  .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
  .sort();
const expected = [
  "src/pages/nba/index.astro",
  "src/pages/nba/players/[slug].astro",
  "src/pages/nba/players/index.astro",
  "src/pages/nba/teams/[slug].astro",
  "src/pages/nba/teams/index.astro",
  "src/pages/nba/trades/[slug].astro",
  "src/pages/nba/trades/index.astro",
].sort();
assert(JSON.stringify(files) === JSON.stringify(expected), `Unexpected route-source files:\n${files.join("\n")}`);

const shell = await readFile("src/lib/nba/PrivateNbaPage.astro", "utf8");
for (const required of [
  'meta name="robots" content="noindex,nofollow"',
  'data-nba-private="true"',
  'data-ad-eligible="false"',
  'data-publication-ready="false"',
]) {
  assert(shell.includes(required), `Private shell is missing: ${required}`);
}
assert(!/adsbygoogle|googlesyndication|data-ad-slot/iu.test(shell), "Ad code detected.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "2Q",
  routeSourceFiles: files.length,
  routeModels: models.counts.routeModels,
  internalLinks: models.counts.internalLinks,
  privateShells: 1,
  storeWrites: false,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
