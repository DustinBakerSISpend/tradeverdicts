import fs from "node:fs";
import path from "node:path";
import {
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
  isPublicPlayerRecord,
} from "../../src/utils/publicRecords.js";

const repo = process.cwd();
const outputPath = process.argv[2];

const repairs = [
  {
    "name": "Bill Cooke",
    "slug": "bill-cooke",
    "tradeSlug": "ernie-price-detroit-lions-1978",
    "assetName": "Bill Cooke"
  },
  {
    "name": "Billy Volek",
    "slug": "billy-volek",
    "tradeSlug": "billy-volek-tennessee-titans-2006",
    "assetName": "Billy Volek"
  },
  {
    "name": "Bob Moore",
    "slug": "bob-moore",
    "tradeSlug": "wally-chambers-chicago-bears-1978",
    "assetName": "Bob Moore"
  },
  {
    "name": "Cedrick Hardman",
    "slug": "cedrick-hardman",
    "tradeSlug": "cedrick-hardman-san-francisco-49ers-1980",
    "assetName": "Cedrick Hardman"
  },
  {
    "name": "Desmond King",
    "slug": "desmond-king",
    "tradeSlug": "2021-6th-round-pick-185th-overall-nick-niemann-tennessee-titans-2",
    "assetName": "Desmond King"
  },
  {
    "name": "Duke Johnson",
    "slug": "duke-johnson",
    "tradeSlug": "2020-3rd-round-pick-97th-overall-jacob-phillips-houston-texans-2019",
    "assetName": "Duke Johnson"
  },
  {
    "name": "Elijah Molden",
    "slug": "elijah-molden",
    "tradeSlug": "elijah-molden-tennessee-titans-2024",
    "assetName": "Elijah Molden"
  },
  {
    "name": "James Ferguson / Jim Ferguson",
    "slug": "james-ferguson-jim-ferguson",
    "tradeSlug": "jerry-jones-new-orleans-saints-1969",
    "assetName": "Jim Ferguson"
  },
  {
    "name": "Jarrett Stidham",
    "slug": "jarrett-stidham",
    "tradeSlug": "jarrett-stidham-and-2023-7th-round-pick-231st-overall-new-england-patriots-2022",
    "assetName": "Jarrett Stidham"
  },
  {
    "name": "Jim Hester / Jimmy Hester",
    "slug": "jim-hester-jimmy-hester",
    "tradeSlug": "saints-1970-03-02-chicago-bears-loyd-phillips",
    "assetName": "Jim Hester"
  },
  {
    "name": "Jonathan Greenard",
    "slug": "jonathan-greenard",
    "tradeSlug": "draft-pick-trade-philadelphia-eagles-2026",
    "assetName": "Jonathan Greenard"
  },
  {
    "name": "Leo Brooks / Lee Brooks",
    "slug": "leo-brooks-lee-brooks",
    "tradeSlug": "saints-1973-08-20-houston-oilers-tennessee-titans-leo-brooks-lee-brooks",
    "assetName": "Leo Brooks"
  },
  {
    "name": "Michael Pittman",
    "slug": "michael-pittman",
    "tradeSlug": "2026-6th-round-pick-214th-overall-caden-curry-pittsburgh-steelers-2026",
    "assetName": "Michael Pittman"
  }
];
const suppressions = [
  {
    "name": "100",
    "slug": "100",
    "reason": "non-player-asset-value"
  },
  {
    "name": "202",
    "slug": "202",
    "reason": "non-player-asset-value"
  },
  {
    "name": "conveys if Mims makes DET 53-man roster (did not convey",
    "slug": "conveys-if-mims-makes-det-53-man-roster-did-not-convey",
    "reason": "non-player-asset-value"
  },
  {
    "name": "did not convey",
    "slug": "did-not-convey",
    "reason": "non-player-asset-value"
  },
  {
    "name": "No asset listed in raw source",
    "slug": "no-asset-listed-in-raw-source",
    "reason": "non-player-asset-value"
  },
  {
    "name": "No consideration recorded",
    "slug": "no-consideration-recorded",
    "reason": "non-player-asset-value"
  },
  {
    "name": "Not clearly specified in source",
    "slug": "not-clearly-specified-in-source",
    "reason": "non-player-asset-value"
  },
  {
    "name": "not conveyed",
    "slug": "not-conveyed",
    "reason": "non-player-asset-value"
  },
  {
    "name": "player to be named later",
    "slug": "player-to-be-named-later",
    "reason": "non-player-asset-value"
  },
  {
    "name": "player to be named later (Jack Zilly on 03-17",
    "slug": "player-to-be-named-later-jack-zilly-on-03-17",
    "reason": "non-player-asset-value"
  },
  {
    "name": "player to be named later (undisclosed",
    "slug": "player-to-be-named-later-undisclosed",
    "reason": "non-player-asset-value"
  },
  {
    "name": "player(s) to be named later (undisclosed",
    "slug": "player-s-to-be-named-later-undisclosed",
    "reason": "non-player-asset-value"
  },
  {
    "name": "UNDISCLOSED",
    "slug": "undisclosed",
    "reason": "non-player-asset-value"
  },
  {
    "name": "Undisclosed compensation",
    "slug": "undisclosed-compensation",
    "reason": "non-player-asset-value"
  },
  {
    "name": "undisclosed consideration",
    "slug": "undisclosed-consideration",
    "reason": "non-player-asset-value"
  },
  {
    "name": "undisclosed historical consideration",
    "slug": "undisclosed-historical-consideration",
    "reason": "non-player-asset-value"
  },
  {
    "name": "undisclosed terms",
    "slug": "undisclosed-terms",
    "reason": "non-player-asset-value"
  },
  {
    "name": "undisclosed terms (undisclosed",
    "slug": "undisclosed-terms-undisclosed",
    "reason": "non-player-asset-value"
  }
];

const players = JSON.parse(
  fs.readFileSync(path.join(repo, "src/data/nfl/players.json"), "utf8").replace(/^\uFEFF/, "")
);
const trades = JSON.parse(
  fs.readFileSync(path.join(repo, "src/data/nfl/trades.json"), "utf8").replace(/^\uFEFF/, "")
);

const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(players, publicTrades);
const publicPlayerSlugSet = new Set(publicPlayers.map((player) => player.slug));
const errors = [];

for (const repair of repairs) {
  const matches = players.filter(
    (player) => player.slug === repair.slug && player.name === repair.name
  );

  if (matches.length !== 1) {
    errors.push(`${repair.slug}: exact record count is ${matches.length}.`);
    continue;
  }

  const player = matches[0];

  if (!player.tradeSlugs.includes(repair.tradeSlug)) {
    errors.push(`${repair.slug}: repaired tradeSlug is missing.`);
  }

  const related = getRelatedPublicTrades(player, publicTrades);
  if (!related.some((trade) => trade.slug === repair.tradeSlug)) {
    errors.push(`${repair.slug}: repaired trade is not returned as related.`);
  }

  if (!publicPlayerSlugSet.has(repair.slug)) {
    errors.push(`${repair.slug}: repaired player did not become public.`);
  }
}

for (const suppression of suppressions) {
  const matches = players.filter(
    (player) =>
      player.slug === suppression.slug &&
      player.name === suppression.name
  );

  if (matches.length !== 1) {
    errors.push(`${suppression.slug}: exact suppression record count is ${matches.length}.`);
    continue;
  }

  const player = matches[0];

  if (player.suppressed !== true) {
    errors.push(`${suppression.slug}: explicit suppressed flag is missing.`);
  }

  if (player.suppressionReason !== suppression.reason) {
    errors.push(`${suppression.slug}: suppression reason mismatch.`);
  }

  if (isPublicPlayerRecord(player)) {
    errors.push(`${suppression.slug}: suppressed record remains public.`);
  }

  if (publicPlayerSlugSet.has(suppression.slug)) {
    errors.push(`${suppression.slug}: suppressed route remains in public players.`);
  }
}

const relationshipCounts = publicPlayers.map((player) => ({
  slug: player.slug,
  count: getRelatedPublicTrades(player, publicTrades).length,
}));

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    repairsApplied: repairs.length,
    suppressionsApplied: suppressions.length,
    publicTrades: publicTrades.length,
    exactPublicPlayerRoutes: publicPlayers.length,
    oneExactPublicTrade: relationshipCounts.filter((row) => row.count === 1).length,
    multipleExactPublicTrades: relationshipCounts.filter((row) => row.count > 1).length,
    zeroExactPublicTrades: relationshipCounts.filter((row) => row.count === 0).length,
  },
  errors,
};

fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (errors.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));