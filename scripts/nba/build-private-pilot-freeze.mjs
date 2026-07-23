#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const args = parseArgs(process.argv);
for (const required of [
  "repo-root",
  "output-json",
  "branch",
  "head",
  "bundle-path",
  "bundle-sha256",
  "audit-json",
]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const git = process.platform === "win32" ? "git.exe" : "git";
const namespaces = ["scripts/nba", "src/data/nba", "src/lib/nba", "src/pages/nba"];
const listed = execFileSync(
  git,
  ["ls-tree", "-r", "--name-only", args.head, "--", ...namespaces],
  { cwd: args["repo-root"], encoding: "utf8" },
)
  .split(/\r?\n/u)
  .map((value) => value.trim())
  .filter(Boolean)
  .sort();

assert(listed.length > 0, "No committed NBA pilot files were found.");

const files = [];
for (const relativePath of listed) {
  const fullPath = path.join(args["repo-root"], ...relativePath.split("/"));
  const bytes = await readFile(fullPath);
  files.push({
    path: relativePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

const packageJsonPath = path.join(args["repo-root"], "package.json");
const packageLockPath = path.join(args["repo-root"], "package-lock.json");
const astroConfigPath = path.join(args["repo-root"], "astro.config.mjs");
const [packageBytes, packageLockBytes, astroConfigBytes, auditBytes, bundleBytes] =
  await Promise.all([
    readFile(packageJsonPath),
    readFile(packageLockPath),
    readFile(astroConfigPath),
    readFile(args["audit-json"]),
    readFile(args["bundle-path"]),
  ]);

const packageJson = JSON.parse(packageBytes.toString("utf8"));
const audit = JSON.parse(auditBytes.toString("utf8"));
assert(audit.result === "PASS" && audit.phase === "2R", "Exposure audit is not a Phase 2R PASS.");
assert(audit.counts.sitemapNbaUrls === 0, "Freeze rejected: NBA URL exists in sitemap.");
assert(audit.counts.publicNbaLinks === 0, "Freeze rejected: public page links to NBA.");
assert(audit.counts.privateNbaPages === 123, "Freeze rejected: private NBA page count mismatch.");
assert(sha256(bundleBytes).toUpperCase() === args["bundle-sha256"].toUpperCase(), "Bundle hash mismatch.");

const namespaceCounts = {};
for (const namespace of namespaces) {
  namespaceCounts[namespace] = files.filter(
    (entry) => entry.path === namespace || entry.path.startsWith(`${namespace}/`),
  ).length;
}

const output = {
  schemaVersion: 1,
  phase: "2R",
  status: "PRIVATE_PILOT_FROZEN",
  branch: args.branch,
  head: args.head,
  namespaces,
  namespaceCounts,
  committedNbaFiles: files.length,
  committedNbaBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
  files,
  platform: {
    astro: packageJson.dependencies?.astro ?? packageJson.devDependencies?.astro ?? null,
    sitemap:
      packageJson.dependencies?.["@astrojs/sitemap"] ??
      packageJson.devDependencies?.["@astrojs/sitemap"] ??
      null,
  },
  criticalHashes: {
    astroConfigSha256: sha256(astroConfigBytes),
    packageJsonSha256: sha256(packageBytes),
    packageLockSha256: sha256(packageLockBytes),
    exposureAuditSha256: sha256(auditBytes),
    recoveryBundleSha256: sha256(bundleBytes),
  },
  recoveryBundle: args["bundle-path"],
  exposureAudit: args["audit-json"],
  verifiedCounts: audit.counts,
  safety: {
    privatePilotOnly: true,
    publicationAuthorized: false,
    remoteBranchPresent: false,
    upstreamPresent: false,
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
  status: output.status,
  committedNbaFiles: output.committedNbaFiles,
  committedNbaBytes: output.committedNbaBytes,
  astro: output.platform.astro,
  sitemap: output.platform.sitemap,
  sitemapNbaUrls: audit.counts.sitemapNbaUrls,
  publicNbaLinks: audit.counts.publicNbaLinks,
  privateNbaPages: audit.counts.privateNbaPages,
}, null, 2));
