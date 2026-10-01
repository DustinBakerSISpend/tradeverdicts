import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(repo, "dist");
const site = "https://tradeverdicts.com";

const eligibility = await import(pathToFileURL(path.join(repo, "src/utils/eligibility.js")).href);
const publicRecords = await import(pathToFileURL(path.join(repo, "src/utils/publicRecords.js")).href);
const playerEligibility = await import(pathToFileURL(path.join(repo, "src/utils/playerEligibility.js")).href);
const teamPairs = await import(pathToFileURL(path.join(repo, "src/utils/teamPairHistory.js")).href);
const teamRegistry = await import(pathToFileURL(path.join(repo, "src/utils/teamRegistry.js")).href);

const trades = JSON.parse(
  fs.readFileSync(path.join(repo, "src/data/nfl/trades.json"), "utf8").replace(/^\uFEFF/, "")
);
const players = JSON.parse(
  fs.readFileSync(path.join(repo, "src/data/nfl/players.json"), "utf8").replace(/^\uFEFF/, "")
);

const tradeContext = eligibility.createEligibilityContext(trades);
const publicTrades = publicRecords.getPublicTrades(trades);
const publicPlayers = publicRecords.getPublicPlayerRecords(players, publicTrades);
const playerContext = playerEligibility.createPlayerEligibilityContext(
  publicPlayers,
  publicTrades,
  tradeContext
);

const tradeUrls = publicTrades
  .filter((trade) => eligibility.getTradeEligibility(trade, tradeContext).indexEligible)
  .map((trade) => site + "/trades/" + trade.slug + "/")
  .sort();

const playerUrls = playerEligibility
  .getIndexEligiblePlayers(publicPlayers, publicTrades, playerContext)
  .map((player) => site + "/players/" + player.slug + "/")
  .sort();

const teamUrls = teamRegistry.CURRENT_NFL_TEAM_SLUGS
  .map((slug) => site + "/teams/" + slug + "/")
  .sort();

const pairUrls = teamPairs
  .getTeamPairEntries(publicTrades)
  .map((entry) => site + entry.path)
  .sort();

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const renderUrlset = (urls) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((url) => "  <url><loc>" + escapeXml(url) + "</loc></url>").join("\n") +
  "\n</urlset>\n";

const files = [
  ["sitemap-nfl-trades.xml", tradeUrls],
  ["sitemap-nfl-players.xml", playerUrls],
  ["sitemap-nfl-teams.xml", teamUrls],
  ["sitemap-nfl-team-pairs.xml", pairUrls],
];

for (const [name, urls] of files) {
  fs.writeFileSync(path.join(dist, name), renderUrlset(urls), "utf8");
}

const indexPath = path.join(dist, "sitemap-index.xml");
if (!fs.existsSync(indexPath)) {
  throw new Error("Astro sitemap index missing at " + indexPath);
}

let indexXml = fs.readFileSync(indexPath, "utf8");

for (const [name] of files) {
  const loc = site + "/" + name;
  if (!indexXml.includes("<loc>" + loc + "</loc>")) {
    indexXml = indexXml.replace(
      "</sitemapindex>",
      "  <sitemap><loc>" + escapeXml(loc) + "</loc></sitemap>\n</sitemapindex>"
    );
  }
}

fs.writeFileSync(indexPath, indexXml, "utf8");

const genericSitemap = fs
  .readdirSync(dist)
  .filter((name) => /^sitemap-\d+\.xml$/i.test(name))
  .map((name) => fs.readFileSync(path.join(dist, name), "utf8"))
  .join("\n");

const forbiddenGeneric = [
  ...tradeUrls.slice(0, 25),
  ...playerUrls.slice(0, 25),
  ...teamUrls.slice(0, 25),
  ...pairUrls.slice(0, 25),
].filter((url) => genericSitemap.includes("<loc>" + url + "</loc>"));

if (forbiddenGeneric.length > 0) {
  throw new Error(
    "NFL category URLs still present in generic sitemap; first duplicate: " +
      forbiddenGeneric[0]
  );
}

const result = {
  status: "PASSED",
  tradeUrls: tradeUrls.length,
  playerUrls: playerUrls.length,
  teamUrls: teamUrls.length,
  teamPairUrls: pairUrls.length,
  sitemapFiles: files.map(([name]) => name),
};

fs.writeFileSync(
  path.join(dist, "nfl-sitemap-manifest.json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(result, null, 2));
