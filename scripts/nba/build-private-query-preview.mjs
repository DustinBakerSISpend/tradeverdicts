#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { createPrivateNbaQueryService } from "../../src/lib/nba/private-query-service.mjs";

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
  "index-json",
  "audit-json",
  "samples-csv",
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

const index = buildPrivateQueryIndex({ trades, players, teams });
const service = createPrivateNbaQueryService(index, teams);

const queries = {
  washingtonByAbbreviation: service.getTradesByTeam("WAS"),
  lakersByName: service.getTradesByTeam("Los Angeles Lakers"),
  busiestDate: service.getTradesByDate("2025-02-06"),
  missingDate: service.getTradesByDate("1999-01-01"),
  ruiSharedTrade: service.getTradeBySourceTradeId("WAS-2023-0016"),
  aytonSharedTrade: service.getTradeBySourceTradeId("WAS-2026-0026"),
  missingSourceTrade: service.getTradeBySourceTradeId("WAS-2099-9999"),
  ajAlias: service.resolvePlayerIdentity("A.J. Johnson"),
  ishAlias: service.resolvePlayerIdentity("Ishmael Smith"),
  excludedChristian: service.resolvePlayerIdentity("Christian"),
  dillonJonesTrades: service.getTradesByPlayerIdentity("Dillon Jones"),
  ambiguousJonesSearch: service.searchPlayers("Jones"),
  ruiPlayers: service.getPlayersByTradeSourceId("WAS-2023-0016"),
};

const assertions = {
  washingtonTeamCount: queries.washingtonByAbbreviation.status === "unique" &&
    queries.washingtonByAbbreviation.teamSlug === "washington-wizards" &&
    queries.washingtonByAbbreviation.count === 27,
  lakersTeamCount: queries.lakersByName.status === "unique" &&
    queries.lakersByName.count === 2,
  busiestDateCount: queries.busiestDate.status === "found" &&
    queries.busiestDate.count === 3,
  missingDateSafe: queries.missingDate.status === "not_found" &&
    queries.missingDate.count === 0,
  ruiSharedPerspective: queries.ruiSharedTrade.status === "unique" &&
    queries.ruiSharedTrade.trade.perspectiveTeams.length === 2 &&
    queries.ruiSharedTrade.trade.perspectiveTeams.includes("los-angeles-lakers") &&
    queries.ruiSharedTrade.trade.perspectiveTeams.includes("washington-wizards"),
  aytonSharedPerspective: queries.aytonSharedTrade.status === "unique" &&
    queries.aytonSharedTrade.trade.perspectiveTeams.length === 2 &&
    queries.aytonSharedTrade.trade.perspectiveTeams.includes("los-angeles-lakers") &&
    queries.aytonSharedTrade.trade.perspectiveTeams.includes("washington-wizards"),
  missingSourceSafe: queries.missingSourceTrade.status === "not_found",
  ajAliasUnique: queries.ajAlias.status === "unique" &&
    queries.ajAlias.player.name === "AJ Johnson",
  ishAliasUnique: queries.ishAlias.status === "unique" &&
    queries.ishAlias.player.name === "Ish Smith",
  excludedAnnotationSafe: queries.excludedChristian.status === "not_found",
  dillonJonesCount: queries.dillonJonesTrades.status === "unique" &&
    queries.dillonJonesTrades.count === 3,
  ambiguousSearchSafe: queries.ambiguousJonesSearch.status === "ambiguous" &&
    queries.ambiguousJonesSearch.players.length === 3,
  ruiPlayerCount: queries.ruiPlayers.status === "found" &&
    queries.ruiPlayers.count === 3,
};

const failedAssertions = Object.entries(assertions)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

if (failedAssertions.length) {
  throw new Error(`Private query assertions failed: ${failedAssertions.join(", ")}`);
}

const audit = {
  mode: "DRY_RUN_PRIVATE_QUERY_AUDIT_ONLY",
  phase: "2O",
  counts: index.counts,
  assertions,
  failedAssertions,
  queries,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
  routesCreated: false,
  buildPerformed: false,
  pushPerformed: false,
  deployPerformed: false,
};

const serializableIndex = {
  schemaVersion: index.schemaVersion,
  mode: "DRY_RUN_PRIVATE_QUERY_INDEX_PREVIEW_ONLY",
  phase: "2O",
  counts: index.counts,
  hashes: index.hashes,
  indexes: index.indexes,
  representedTeams: index.representedTeams,
  uniqueDates: index.uniqueDates,
  ambiguousIdentityKeys: index.ambiguousIdentityKeys,
  sharedPerspectiveTradeIds: index.sharedPerspectiveTradeIds,
  canonicalStoreSha256: sha256(tradeBytes),
  playerStoreSha256: sha256(playerBytes),
  teamRegistrySha256: sha256(teamBytes),
  repositoryWrites: false,
  routesCreated: false,
};

await mkdir(path.dirname(args["index-json"]), { recursive: true });
await mkdir(path.dirname(args["audit-json"]), { recursive: true });
await mkdir(path.dirname(args["samples-csv"]), { recursive: true });
await writeFile(args["index-json"], `${JSON.stringify(serializableIndex, null, 2)}\n`, "utf8");
await writeFile(args["audit-json"], `${JSON.stringify(audit, null, 2)}\n`, "utf8");

const rows = [
  ["team", "WAS", queries.washingtonByAbbreviation.status, queries.washingtonByAbbreviation.count, "Washington team abbreviation"],
  ["team", "Los Angeles Lakers", queries.lakersByName.status, queries.lakersByName.count, "Full team name"],
  ["date", "2025-02-06", queries.busiestDate.status, queries.busiestDate.count, "Three same-day trades"],
  ["date", "1999-01-01", queries.missingDate.status, queries.missingDate.count, "Safe zero result"],
  ["source_trade_id", "WAS-2023-0016", queries.ruiSharedTrade.status, queries.ruiSharedTrade.trade?.perspectiveTeams.length ?? 0, "Rui shared perspectives"],
  ["source_trade_id", "WAS-2026-0026", queries.aytonSharedTrade.status, queries.aytonSharedTrade.trade?.perspectiveTeams.length ?? 0, "Ayton shared perspectives"],
  ["player_identity", "A.J. Johnson", queries.ajAlias.status, queries.ajAlias.player?.sourceTradeCount ?? 0, "Approved punctuation alias"],
  ["player_identity", "Ishmael Smith", queries.ishAlias.status, queries.ishAlias.player?.sourceTradeCount ?? 0, "Approved source alias"],
  ["player_identity", "Christian", queries.excludedChristian.status, 0, "Excluded annotation"],
  ["player_search", "Jones", queries.ambiguousJonesSearch.status, queries.ambiguousJonesSearch.players?.length ?? 0, "Ambiguous partial search"],
  ["player_trades", "Dillon Jones", queries.dillonJonesTrades.status, queries.dillonJonesTrades.count, "Direct, rights, and outcome links"],
];

const headers = ["Query Type", "Query", "Status", "Result Count", "Purpose"];
await writeFile(
  args["samples-csv"],
  `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8",
);

console.log(JSON.stringify({
  result: "PASS",
  phase: "2O",
  ...index.counts,
  queryAssertions: Object.keys(assertions).length,
  failedAssertions: failedAssertions.length,
  washingtonTrades: queries.washingtonByAbbreviation.count,
  lakersTrades: queries.lakersByName.count,
  busiestDateTrades: queries.busiestDate.count,
  dillonJonesTrades: queries.dillonJonesTrades.count,
  ambiguousJonesPlayers: queries.ambiguousJonesSearch.players.length,
  sharedPerspectiveQueries: 2,
  repositoryWrites: false,
  canonicalStoreWrites: false,
  playerStoreWrites: false,
}, null, 2));
