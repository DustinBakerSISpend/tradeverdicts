#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
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
function routeFile(dist, route) {
  return path.join(dist, ...route.split("/").filter(Boolean), "index.html");
}
function normalizeHref(value) {
  const pathOnly = String(value ?? "").split(/[?#]/u)[0];
  if (!pathOnly.startsWith("/nba/")) return null;
  return pathOnly.endsWith("/") ? pathOnly : `${pathOnly}/`;
}

const input = args(process.argv);
for (const key of ["dist-dir", "trades-json", "players-json", "teams-json", "output-json"]) {
  if (!input[key]) throw new Error(`Missing --${key}`);
}

const [tradeBytes, playerBytes, teamBytes] = await Promise.all([
  readFile(input["trades-json"]),
  readFile(input["players-json"]),
  readFile(input["teams-json"]),
]);
const trades = JSON.parse(tradeBytes);
const players = JSON.parse(playerBytes);
const teams = JSON.parse(teamBytes);
const routeModels = buildPrivateRouteModels({ trades, players, teams });
const expectedPaths = routeModels.models.map((model) => model.path).sort();
const expectedSet = new Set(expectedPaths);
const nbaDir = path.join(input["dist-dir"], "nba");
assert((await stat(nbaDir)).isDirectory(), "Built NBA directory is missing.");

const actualFiles = (await listFiles(nbaDir)).filter((file) => file.endsWith(".html")).sort();
const expectedFiles = expectedPaths.map((route) => routeFile(input["dist-dir"], route));
const missing = expectedFiles.filter((file) => !actualFiles.includes(file));
const unexpected = actualFiles.filter((file) => !expectedFiles.includes(file));

let internalLinks = 0;
const broken = [];
const privacyFailures = [];
const adMarkers = [];
const htmlHashes = {};

for (const file of actualFiles) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(input["dist-dir"], file).replaceAll("\\", "/");
  const lower = html.toLowerCase();
  htmlHashes[relative] = sha256(html);

  const guarded =
    lower.includes('name="robots" content="noindex,nofollow"') &&
    lower.includes('name="googlebot" content="noindex,nofollow"') &&
    lower.includes('name="bingbot" content="noindex,nofollow"') &&
    lower.includes('data-nba-private="true"') &&
    lower.includes('data-index-eligible="false"') &&
    lower.includes('data-ad-eligible="false"') &&
    lower.includes('data-publication-ready="false"');
  if (!guarded) privacyFailures.push(relative);

  for (const marker of ["adsbygoogle", "googlesyndication", "data-ad-slot"]) {
    if (lower.includes(marker)) adMarkers.push({ file: relative, marker });
  }

  for (const match of html.matchAll(/href=(?:"([^"]+)"|'([^']+)')/gu)) {
    const href = match[1] ?? match[2];
    const normalized = normalizeHref(href);
    if (!normalized) continue;
    internalLinks += 1;
    if (!expectedSet.has(normalized)) broken.push({ file: relative, href, normalized });
  }
}

const sourceFiles = (await listFiles(path.resolve("src/pages/nba")))
  .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
  .sort();

const counts = {
  expectedRoutePages: expectedPaths.length,
  builtRoutePages: actualFiles.length,
  routeSourceFiles: sourceFiles.length,
  internalLinks,
  missingHtmlFiles: missing.length,
  unexpectedHtmlFiles: unexpected.length,
  brokenLinks: broken.length,
  privacyFailures: privacyFailures.length,
  adMarkers: adMarkers.length,
  privatePages: actualFiles.length - privacyFailures.length,
  noindexPages: actualFiles.length - privacyFailures.length,
  adFreePages: actualFiles.length - adMarkers.length,
};

const expectedCounts = {
  expectedRoutePages: 123,
  builtRoutePages: 123,
  routeSourceFiles: 7,
  internalLinks: 434,
  missingHtmlFiles: 0,
  unexpectedHtmlFiles: 0,
  brokenLinks: 0,
  privacyFailures: 0,
  adMarkers: 0,
  privatePages: 123,
  noindexPages: 123,
  adFreePages: 123,
};
assert(JSON.stringify(counts) === JSON.stringify(expectedCounts),
  `Unexpected private build counts:\n${JSON.stringify(counts, null, 2)}`);

const output = {
  result: "PASS",
  phase: "2Q",
  counts,
  expectedPaths,
  sourceFiles,
  issues: { missing, unexpected, broken, privacyFailures, adMarkers },
  hashes: {
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamRegistrySha256: sha256(teamBytes),
    routePathSetSha256: sha256(expectedPaths.join("\n")),
    builtHtmlSetSha256: sha256(
      Object.entries(htmlHashes).sort(([a], [b]) => a.localeCompare(b))
        .map(([file, hash]) => `${file}|${hash}`).join("\n"),
    ),
  },
  safety: {
    localBuildOnly: true,
    routesPrivate: true,
    pushPerformed: false,
    previewDeploymentPerformed: false,
    productionDeploymentPerformed: false,
  },
};
await mkdir(path.dirname(input["output-json"]), { recursive: true });
await writeFile(input["output-json"], `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ result: "PASS", phase: "2Q", ...counts, localBuildOnly: true }, null, 2));
