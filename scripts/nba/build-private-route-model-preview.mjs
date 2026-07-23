#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const args = parseArgs(process.argv);
for (const required of [
  "trades-json",
  "players-json",
  "teams-json",
  "manifest-json",
  "audit-json",
  "summary-csv",
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
const result = buildPrivateRouteModels({ trades, players, teams });

const modelByPath = new Map(result.models.map((model) => [model.path, model]));
const ruiTrade = trades.find((trade) => trade.sourceTradeId === "WAS-2023-0016");
const aytonTrade = trades.find((trade) => trade.sourceTradeId === "WAS-2026-0026");
const ajPlayer = players.find((player) => player.name === "AJ Johnson");
const ishPlayer = players.find((player) => player.name === "Ish Smith");

const samples = {
  root: modelByPath.get("/nba/"),
  ruiSharedTrade: modelByPath.get(`/nba/trades/${ruiTrade.slug}/`),
  aytonSharedTrade: modelByPath.get(`/nba/trades/${aytonTrade.slug}/`),
  ajCanonicalPlayer: modelByPath.get(`/nba/players/${ajPlayer.slug}/`),
  ishCanonicalPlayer: modelByPath.get(`/nba/players/${ishPlayer.slug}/`),
  washingtonTeam: modelByPath.get("/nba/teams/washington-wizards/"),
};

const assertions = {
  rootHasThreeSections: samples.root?.links.length === 3,
  ruiIsOneSharedTradeModel:
    samples.ruiSharedTrade?.sharedPerspective === true &&
    samples.ruiSharedTrade?.perspectiveTeams.length === 2,
  aytonIsOneSharedTradeModel:
    samples.aytonSharedTrade?.sharedPerspective === true &&
    samples.aytonSharedTrade?.perspectiveTeams.length === 2,
  ajUsesCanonicalRoute:
    samples.ajCanonicalPlayer?.entityId === ajPlayer.id &&
    !modelByPath.has("/nba/players/a-j-johnson/"),
  ishUsesCanonicalRoute:
    samples.ishCanonicalPlayer?.entityId === ishPlayer.id &&
    !modelByPath.has("/nba/players/ishmael-smith/"),
  washingtonLinksAllTrades:
    samples.washingtonTeam?.linkedTradeCount === 27 &&
    samples.washingtonTeam?.links.length === 27,
  noRoutesCreated: result.counts.routeCreatedModels === 0,
  allLinksResolve: result.counts.brokenLinks === 0,
  allModelsPrivate:
    result.counts.privateRouteModels === result.counts.routeModels &&
    result.counts.noindexRouteModels === result.counts.routeModels &&
    result.counts.adFreeRouteModels === result.counts.routeModels,
};

const failedAssertions = Object.entries(assertions)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

if (failedAssertions.length) {
  throw new Error(`Private route-model assertions failed: ${failedAssertions.join(", ")}`);
}

const manifest = {
  schemaVersion: result.schemaVersion,
  mode: "DRY_RUN_PRIVATE_ROUTE_MANIFEST_PREVIEW_ONLY",
  phase: "2P",
  counts: result.counts,
  hashes: result.hashes,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  models: result.models,
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
  routesCreated: false,
  buildPerformed: false,
  pushPerformed: false,
  deployPerformed: false,
};

const audit = {
  mode: "DRY_RUN_PRIVATE_ROUTE_LINK_AUDIT_ONLY",
  phase: "2P",
  counts: result.counts,
  assertions,
  failedAssertions,
  samples,
  issues: result.audit,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  routeCreationAuthorized: false,
  repositoryWrites: false,
  routesCreated: false,
};

await mkdir(path.dirname(args["manifest-json"]), { recursive: true });
await mkdir(path.dirname(args["audit-json"]), { recursive: true });
await mkdir(path.dirname(args["summary-csv"]), { recursive: true });

await writeFile(args["manifest-json"], `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(args["audit-json"], `${JSON.stringify(audit, null, 2)}\n`, "utf8");

const headers = [
  "Path",
  "Route Type",
  "Entity ID",
  "Title",
  "Link Count",
  "Private",
  "Noindex",
  "Ad Free",
  "Sitemap Eligible",
  "Route Created",
];
const rows = result.models.map((model) => [
  model.path,
  model.routeType,
  model.entityId ?? "",
  model.title,
  model.links.length,
  model.privacy.publishStatus === "private",
  model.privacy.indexEligible === false,
  model.privacy.adEligible === false,
  model.privacy.sitemapEligible,
  model.privacy.routeCreated,
]);

await writeFile(
  args["summary-csv"],
  `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2P",
  ...result.counts,
  routeAssertions: Object.keys(assertions).length,
  failedAssertions: failedAssertions.length,
  ruiPerspectiveTeams: samples.ruiSharedTrade.perspectiveTeams.length,
  aytonPerspectiveTeams: samples.aytonSharedTrade.perspectiveTeams.length,
  washingtonTradeLinks: samples.washingtonTeam.linkedTradeCount,
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
  routesCreated: false,
}, null, 2));
