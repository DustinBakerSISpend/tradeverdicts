#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const output = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key}`);
    output[key.slice(2)] = value;
  }
  return output;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function listFiles(root) {
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else output.push(full);
    }
  }
  await walk(root);
  return output;
}

const args = parseArgs(process.argv);
for (const required of ["astro-config", "pages-dir", "private-shell"]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

assert((await stat(args["pages-dir"])).isDirectory(), "NBA route-source directory is missing.");

const routeFiles = (await listFiles(args["pages-dir"]))
  .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
  .sort();

const expectedRouteFiles = [
  "src/pages/nba/index.astro",
  "src/pages/nba/players/[slug].astro",
  "src/pages/nba/players/index.astro",
  "src/pages/nba/teams/[slug].astro",
  "src/pages/nba/teams/index.astro",
  "src/pages/nba/trades/[slug].astro",
  "src/pages/nba/trades/index.astro",
].sort();

assert(
  JSON.stringify(routeFiles) === JSON.stringify(expectedRouteFiles),
  `Unexpected NBA route-source files:\n${routeFiles.join("\n")}`,
);

const config = await readFile(args["astro-config"], "utf8");
assert(
  /import\s+sitemap\s+from\s+["']@astrojs\/sitemap["']/u.test(config),
  "Astro sitemap integration import is missing.",
);
assert(
  /sitemap\s*\(\s*\{[\s\S]*?filter\s*:\s*shouldIncludeInSitemap[\s\S]*?\}\s*\)/u.test(config),
  "The sitemap integration is not using shouldIncludeInSitemap.",
);
assert(
  /const\s+shouldIncludeInSitemap\s*=\s*\(\s*page\s*\)\s*=>/u.test(config),
  "shouldIncludeInSitemap is missing.",
);
assert(
  !/customPages\s*:[\s\S]*?\/nba\//iu.test(config),
  "Astro config explicitly adds an NBA custom sitemap page.",
);

const shell = await readFile(args["private-shell"], "utf8");
for (const marker of [
  'meta name="robots" content="noindex,nofollow"',
  'meta name="googlebot" content="noindex,nofollow"',
  'meta name="bingbot" content="noindex,nofollow"',
  'data-nba-private="true"',
  'data-index-eligible="false"',
  'data-ad-eligible="false"',
  'data-publication-ready="false"',
]) {
  assert(shell.includes(marker), `Private NBA shell is missing: ${marker}`);
}
assert(!/adsbygoogle|googlesyndication|data-ad-slot/iu.test(shell), "Ad code exists in private NBA shell.");

console.log(JSON.stringify({
  result: "PASS",
  phase: "2R",
  routeSourceFiles: routeFiles.length,
  sitemapFilterPresent: true,
  privateShellGuardMarkers: 7,
  explicitNbaCustomPages: 0,
  sourceAdMarkers: 0,
}, null, 2));
