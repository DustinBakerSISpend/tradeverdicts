#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { freezeAtlantaImportEligibility } from "../../src/lib/nba/freeze-import-eligibility.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)] = value;
  }
  return args;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedTextHash(bytes) {
  return sha256(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n"));
}

function csv(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csv).join(","))
    .join("\r\n")}\r\n`;
}

const args = parseArgs(process.argv);
for (const required of ["phase-3b-json", "phase-3c-json", "players-json", "trades-json", "output-dir"]) {
  assert(args[required], `Missing --${required}`);
}

const [phase3bBytes, phase3cBytes, playerBytes, tradeBytes] = await Promise.all([
  readFile(args["phase-3b-json"]),
  readFile(args["phase-3c-json"]),
  readFile(args["players-json"]),
  readFile(args["trades-json"]),
]);
const phase3b = JSON.parse(phase3bBytes.toString("utf8"));
const phase3c = JSON.parse(phase3cBytes.toString("utf8"));
const players = JSON.parse(playerBytes.toString("utf8"));
const trades = JSON.parse(tradeBytes.toString("utf8"));

const frozen = freezeAtlantaImportEligibility({ phase3b, phase3c, players, trades });
const result = {
  ...frozen,
  inputHashes: {
    phase3bPreviewSha256: normalizedTextHash(phase3bBytes),
    phase3cPreviewSha256: normalizedTextHash(phase3cBytes),
    playerStoreSha256: normalizedTextHash(playerBytes),
    canonicalStoreSha256: normalizedTextHash(tradeBytes),
  },
};
const canonicalJson = `${JSON.stringify(result, null, 2)}\n`;
const outputDir = path.resolve(args["output-dir"]);
await mkdir(outputDir, { recursive: true });

const tradeRows = result.tradeManifest.map((entry) => ({
  sourceTradeId: entry.sourceTradeId,
  canonicalTradeId: entry.canonicalTradeId,
  importAction: entry.importAction,
  tradeDate: entry.tradeDate,
  teams: entry.teams,
  dateTeamsKey: entry.dateTeamsKey,
  sourcePerspectiveKey: entry.sourcePerspectiveKey,
  transactionFingerprint: entry.transactionFingerprint,
  assetCount: entry.assetIds.length,
  playerDependencyIds: entry.playerDependencyIds,
  blockers: entry.blockers,
  freezeSha256: entry.freezeSha256,
}));
const playerRows = result.playerManifest.map((entry) => ({
  playerId: entry.playerId,
  importAction: entry.importAction,
  preferredName: entry.preferredName,
  normalizedName: entry.normalizedName,
  slug: entry.slug,
  sourceVariants: entry.sourceVariants,
  sourceTradeIds: entry.sourceTradeIds,
  yearRange: entry.yearRange,
  playerDataReady: entry.playerDataReady,
  blockers: entry.blockers,
  freezeSha256: entry.freezeSha256,
}));
const routeRows = result.assetRoutes.map((route) => ({
  sourceTradeId: route.sourceTradeId,
  canonicalTradeId: route.canonicalTradeId,
  assetId: route.assetId,
  assetType: route.assetType,
  displayText: route.displayText,
  fromTeam: route.fromTeam,
  toTeam: route.toTeam,
  routingAction: route.routingAction,
  routingReady: route.routingReady,
  freezeSha256: route.freezeSha256,
}));
const blockerRows = result.tradeManifest
  .filter((entry) => entry.importAction !== "create-canonical")
  .map((entry) => ({
    sourceTradeId: entry.sourceTradeId,
    canonicalTradeId: entry.canonicalTradeId,
    importAction: entry.importAction,
    blockers: entry.blockers,
    playerDependencyIds: entry.playerDependencyIds,
  }));

await Promise.all([
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-import-freeze.json"), canonicalJson, "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-trade-manifest.csv"), toCsv(tradeRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-player-manifest.csv"), toCsv(playerRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-player-dependency-holds.csv"), toCsv(result.playerDependencyHolds), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-asset-route-manifest.csv"), toCsv(routeRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-player-trade-edge-manifest.csv"), toCsv(result.relationships.playerTradeEdges), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-team-trade-edge-manifest.csv"), toCsv(result.relationships.teamTradeEdges), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-existing-perspective-reconciliation.csv"), toCsv(result.updatePerspectiveManifest), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-blockers.csv"), toCsv(blockerRows), "utf8"),
  writeFile(path.join(outputDir, "atlanta-hawks-phase-3d1-manifest-sha256.txt"), `${sha256(canonicalJson)}  atlanta-hawks-phase-3d1-import-freeze.json\n`, "utf8"),
]);

console.log(JSON.stringify({
  result: result.result,
  phase: result.phase,
  counts: result.counts,
  guards: result.guards,
  canonicalImports: result.canonicalImports,
  playerImports: result.playerImports,
  relationshipImports: result.relationshipImports,
  routeCreation: result.routeCreation,
  repositoryDataWrites: result.repositoryDataWrites,
  manifestSha256: sha256(canonicalJson),
  pushPerformed: result.pushPerformed,
  deployPerformed: result.deployPerformed,
}, null, 2));
