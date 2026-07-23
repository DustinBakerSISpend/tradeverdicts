#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function routeToHtml(distDir, routePath) {
  return path.join(distDir, ...routePath.split("/").filter(Boolean), "index.html");
}

function normalizeNbaHref(href) {
  const raw = String(href ?? "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
    return null;
  }

  try {
    const url = new URL(raw, "https://tradeverdicts.com/");
    if (url.origin !== "https://tradeverdicts.com") return null;
    if (url.pathname === "/nba" || url.pathname.startsWith("/nba/")) {
      return url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    }
  } catch {
    return null;
  }

  return null;
}

const args = parseArgs(process.argv);
for (const required of [
  "dist-dir",
  "trades-json",
  "players-json",
  "teams-json",
  "output-json",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [tradeBytes, playerBytes, teamBytes] = await Promise.all([
  readFile(args["trades-json"]),
  readFile(args["players-json"]),
  readFile(args["teams-json"]),
]);

const trades = JSON.parse(tradeBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const teams = JSON.parse(teamBytes.toString("utf8"));
const routeResult = buildPrivateRouteModels({ trades, players, teams });

const expectedNbaPaths = routeResult.models.map((model) => model.path).sort();
const expectedNbaSet = new Set(expectedNbaPaths);
const expectedNbaHtml = expectedNbaPaths.map((routePath) =>
  routeToHtml(args["dist-dir"], routePath),
);

const allFiles = await listFiles(args["dist-dir"]);
const allHtml = allFiles.filter((file) => file.endsWith(".html")).sort();
const nbaRoot = path.join(args["dist-dir"], "nba");
assert((await stat(nbaRoot)).isDirectory(), "Built NBA directory is missing.");
const nbaHtml = (await listFiles(nbaRoot)).filter((file) => file.endsWith(".html")).sort();
const nbaHtmlSet = new Set(nbaHtml);
const publicHtml = allHtml.filter((file) => !nbaHtmlSet.has(file));

const missingNbaHtml = expectedNbaHtml.filter((file) => !nbaHtmlSet.has(file));
const unexpectedNbaHtml = nbaHtml.filter((file) => !expectedNbaHtml.includes(file));

let nbaInternalLinks = 0;
const nbaBrokenLinks = [];
const nbaPrivacyFailures = [];
const nbaAdMarkers = [];
const nbaPublicationMarkers = [];

for (const file of nbaHtml) {
  const html = await readFile(file, "utf8");
  const lower = html.toLowerCase();
  const relative = path.relative(args["dist-dir"], file).replaceAll("\\", "/");

  const guarded =
    lower.includes('name="robots" content="noindex,nofollow"') &&
    lower.includes('name="googlebot" content="noindex,nofollow"') &&
    lower.includes('name="bingbot" content="noindex,nofollow"') &&
    lower.includes('data-nba-private="true"') &&
    lower.includes('data-index-eligible="false"') &&
    lower.includes('data-ad-eligible="false"') &&
    lower.includes('data-publication-ready="false"');

  if (!guarded) nbaPrivacyFailures.push(relative);

  for (const marker of ["adsbygoogle", "googlesyndication", "data-ad-slot"]) {
    if (lower.includes(marker)) nbaAdMarkers.push({ file: relative, marker });
  }

  if (
    lower.includes('data-index-eligible="true"') ||
    lower.includes('data-ad-eligible="true"') ||
    lower.includes('data-publication-ready="true"')
  ) {
    nbaPublicationMarkers.push(relative);
  }

  for (const match of html.matchAll(/href=(?:"([^"]+)"|'([^']+)')/gu)) {
    const href = match[1] ?? match[2];
    const normalized = normalizeNbaHref(href);
    if (!normalized) continue;
    nbaInternalLinks += 1;
    if (!expectedNbaSet.has(normalized)) {
      nbaBrokenLinks.push({ file: relative, href, normalized });
    }
  }
}

const publicNbaLinks = [];
for (const file of publicHtml) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(args["dist-dir"], file).replaceAll("\\", "/");

  for (const match of html.matchAll(/href=(?:"([^"]+)"|'([^']+)')/gu)) {
    const href = match[1] ?? match[2];
    const normalized = normalizeNbaHref(href);
    if (normalized) publicNbaLinks.push({ file: relative, href, normalized });
  }
}

const sitemapFiles = allFiles
  .filter((file) => /^sitemap.*\.xml$/iu.test(path.basename(file)))
  .sort();
assert(sitemapFiles.length > 0, "No generated sitemap XML files were found.");
assert(
  sitemapFiles.some((file) => path.basename(file).toLowerCase() === "sitemap-index.xml"),
  "sitemap-index.xml is missing.",
);

let sitemapUrls = 0;
const sitemapNbaUrls = [];
for (const file of sitemapFiles) {
  const xml = await readFile(file, "utf8");
  const relative = path.relative(args["dist-dir"], file).replaceAll("\\", "/");

  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)) {
    sitemapUrls += 1;
    const value = match[1].replaceAll("&amp;", "&");
    try {
      const url = new URL(value);
      if (url.pathname === "/nba" || url.pathname.startsWith("/nba/")) {
        sitemapNbaUrls.push({ file: relative, url: value });
      }
    } catch {
      if (/\/nba(?:\/|$)/iu.test(value)) sitemapNbaUrls.push({ file: relative, url: value });
    }
  }
}

const counts = {
  totalBuiltHtmlPages: allHtml.length,
  publicBuiltHtmlPages: publicHtml.length,
  expectedNbaPages: expectedNbaPaths.length,
  builtNbaPages: nbaHtml.length,
  nbaInternalLinks,
  missingNbaHtmlFiles: missingNbaHtml.length,
  unexpectedNbaHtmlFiles: unexpectedNbaHtml.length,
  nbaBrokenLinks: nbaBrokenLinks.length,
  nbaPrivacyFailures: nbaPrivacyFailures.length,
  nbaAdMarkers: nbaAdMarkers.length,
  nbaPublicationMarkers: nbaPublicationMarkers.length,
  privateNbaPages: nbaHtml.length - nbaPrivacyFailures.length,
  noindexNbaPages: nbaHtml.length - nbaPrivacyFailures.length,
  adFreeNbaPages: nbaHtml.length - nbaAdMarkers.length,
  publicNbaLinks: publicNbaLinks.length,
  publicPagesLinkingToNba: new Set(publicNbaLinks.map((entry) => entry.file)).size,
  sitemapFiles: sitemapFiles.length,
  sitemapUrls,
  sitemapNbaUrls: sitemapNbaUrls.length,
};

const fixedExpected = {
  totalBuiltHtmlPages: 12033,
  publicBuiltHtmlPages: 11910,
  expectedNbaPages: 123,
  builtNbaPages: 123,
  nbaInternalLinks: 434,
  missingNbaHtmlFiles: 0,
  unexpectedNbaHtmlFiles: 0,
  nbaBrokenLinks: 0,
  nbaPrivacyFailures: 0,
  nbaAdMarkers: 0,
  nbaPublicationMarkers: 0,
  privateNbaPages: 123,
  noindexNbaPages: 123,
  adFreeNbaPages: 123,
  publicNbaLinks: 0,
  publicPagesLinkingToNba: 0,
  sitemapNbaUrls: 0,
};

for (const [key, expected] of Object.entries(fixedExpected)) {
  assert(counts[key] === expected, `${key}: expected ${expected}, found ${counts[key]}`);
}
assert(counts.sitemapFiles >= 1, "Expected at least one sitemap file.");
assert(counts.sitemapUrls >= 1, "Expected at least one sitemap URL.");

const output = {
  result: "PASS",
  phase: "2R",
  mode: "PRIVATE_EXPOSURE_AND_SITEMAP_ISOLATION_AUDIT",
  counts,
  issues: {
    missingNbaHtml,
    unexpectedNbaHtml,
    nbaBrokenLinks,
    nbaPrivacyFailures,
    nbaAdMarkers,
    nbaPublicationMarkers,
    publicNbaLinks,
    sitemapNbaUrls,
  },
  sitemapFiles: sitemapFiles.map((file) =>
    path.relative(args["dist-dir"], file).replaceAll("\\", "/"),
  ),
  hashes: {
    canonicalStoreSha256: sha256(tradeBytes),
    playerStoreSha256: sha256(playerBytes),
    teamRegistrySha256: sha256(teamBytes),
    nbaRoutePathSetSha256: sha256(expectedNbaPaths.join("\n")),
  },
  safety: {
    localBuildOnly: true,
    nbaRoutesPrivate: true,
    nbaRoutesInSitemap: false,
    publicPagesLinkToNba: false,
    pushPerformed: false,
    previewDeploymentPerformed: false,
    productionDeploymentPerformed: false,
  },
};

await mkdir(path.dirname(args["output-json"]), { recursive: true });
await writeFile(args["output-json"], `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  result: "PASS",
  phase: "2R",
  ...counts,
  localBuildOnly: true,
  pushPerformed: false,
  deployPerformed: false,
}, null, 2));
