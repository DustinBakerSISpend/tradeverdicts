import fs from "node:fs";
import path from "node:path";
import {
  getExplicitPlayerTradeSlugs,
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
  isPublicPlayerRecord,
} from "../../src/utils/publicRecords.js";

const repo = process.cwd();
const outputPath = process.argv[2];
const displayRepairs = [
  {
    "slug": "dave-williams-b",
    "before": "Dave Williams (b",
    "after": "Dave Williams (b)",
    "tradeSlug": "unspecified-consideration-arizonast-louis-cardinals-1972"
  },
  {
    "slug": "jimmy-jones-clyde",
    "before": "Jimmy Jones (Clyde",
    "after": "Jimmy Jones (Clyde)",
    "tradeSlug": "conditional-draft-pick-san-diego-chargers-1969"
  }
];
const fragmentSuppressions = [
  {
    "slug": "ja",
    "name": "Ja",
    "tradeSlug": "jason-pierre-paul-new-york-giants-2018",
    "canonicalSlug": "jason-pierre-paul",
    "canonicalName": "Jason Pierre-Paul"
  },
  {
    "slug": "micah",
    "name": "Micah",
    "tradeSlug": "2024-3rd-round-pick-92nd-overall-detroit-lions-2024",
    "canonicalSlug": "carlton-davis",
    "canonicalName": "Carlton Davis"
  },
  {
    "slug": "nick",
    "name": "Nick",
    "tradeSlug": "steve-mclendon-new-york-jets-2020",
    "canonicalSlug": "steve-mclendon",
    "canonicalName": "Steve McLendon"
  },
  {
    "slug": "sterl",
    "name": "Sterl",
    "tradeSlug": "2019-6th-round-pick-208th-overall-philadelphia-eagles-2019",
    "canonicalSlug": "desean-jackson",
    "canonicalName": "DeSean Jackson"
  }
];

const players = JSON.parse(
  fs
    .readFileSync(
      path.join(repo, "src/data/nfl/players.json"),
      "utf8"
    )
    .replace(/^\uFEFF/, "")
);
const trades = JSON.parse(
  fs
    .readFileSync(
      path.join(repo, "src/data/nfl/trades.json"),
      "utf8"
    )
    .replace(/^\uFEFF/, "")
);

const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(players, publicTrades);
const publicPlayerSlugSet = new Set(
  publicPlayers.map((player) => player.slug)
);

const errors = [];

for (const repair of displayRepairs) {
  const matches = players.filter(
    (player) =>
      player.slug === repair.slug &&
      player.name === repair.after
  );

  if (matches.length !== 1) {
    errors.push(
      `${repair.slug}: expected one repaired record, found ${matches.length}.`
    );
    continue;
  }

  if (!publicPlayerSlugSet.has(repair.slug)) {
    errors.push(`${repair.slug}: repaired route is not public.`);
  }

  if (
    !getRelatedPublicTrades(matches[0], publicTrades).some(
      (trade) => trade.slug === repair.tradeSlug
    )
  ) {
    errors.push(
      `${repair.slug}: repaired route lost its reviewed relationship.`
    );
  }
}

for (const suppression of fragmentSuppressions) {
  const fragmentMatches = players.filter(
    (player) => player.slug === suppression.slug
  );
  const canonicalMatches = players.filter(
    (player) => player.slug === suppression.canonicalSlug
  );

  if (fragmentMatches.length !== 1) {
    errors.push(
      `${suppression.slug}: fragment record count is ${fragmentMatches.length}.`
    );
    continue;
  }

  if (canonicalMatches.length !== 1) {
    errors.push(
      `${suppression.canonicalSlug}: canonical record count is ${canonicalMatches.length}.`
    );
    continue;
  }

  const fragment = fragmentMatches[0];
  const canonical = canonicalMatches[0];

  if (fragment.suppressed !== true) {
    errors.push(`${suppression.slug}: fragment is not suppressed.`);
  }

  if (fragment.suppressionReason !== "orphan-name-fragment") {
    errors.push(
      `${suppression.slug}: fragment suppression reason mismatch.`
    );
  }

  if (fragment.canonicalPlayerSlug !== suppression.canonicalSlug) {
    errors.push(
      `${suppression.slug}: canonical-player pointer mismatch.`
    );
  }

  if (isPublicPlayerRecord(fragment)) {
    errors.push(`${suppression.slug}: fragment remains public.`);
  }

  if (publicPlayerSlugSet.has(suppression.slug)) {
    errors.push(`${suppression.slug}: fragment route remains public.`);
  }

  if (
    !getExplicitPlayerTradeSlugs(canonical).includes(
      suppression.tradeSlug
    )
  ) {
    errors.push(
      `${suppression.canonicalSlug}: canonical relationship is missing.`
    );
  }
}

const siegalMatches = players.filter(
  (player) =>
    player.slug === "siegal" &&
    player.name === "Siegal"
);

if (siegalMatches.length !== 1) {
  errors.push(`Siegal record count is ${siegalMatches.length}.`);
} else {
  if (!publicPlayerSlugSet.has("siegal")) {
    errors.push("Siegal historical route is no longer public.");
  }

  if (
    !getRelatedPublicTrades(
      siegalMatches[0],
      publicTrades
    ).some(
      (trade) =>
        trade.slug === "siegal-brooklyn-dodgers-1939"
    )
  ) {
    errors.push("Siegal lost its explicit historical relationship.");
  }
}

const publicUnbalanced = publicPlayers.filter((player) => {
  const name = String(player?.name || "");

  return (
    (name.match(/\(/g) || []).length !==
    (name.match(/\)/g) || []).length
  );
});

const publicOneToken = publicPlayers.filter(
  (player) =>
    String(player?.name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length === 1
);

const publicOneTokenSlugs = publicOneToken
  .map((player) => player.slug)
  .sort();

if (publicUnbalanced.length !== 0) {
  errors.push(
    `Expected zero public unbalanced names; found ${publicUnbalanced.length}.`
  );
}

if (
  JSON.stringify(publicOneTokenSlugs) !==
  JSON.stringify(["siegal"])
) {
  errors.push(
    `Unexpected public one-token routes: ${publicOneTokenSlugs.join(", ")}`
  );
}

const relationshipCounts = publicPlayers.map((player) => ({
  slug: player.slug,
  count: getRelatedPublicTrades(player, publicTrades).length,
}));

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    displayRepairsApplied: displayRepairs.length,
    orphanFragmentsSuppressed: fragmentSuppressions.length,
    retainedHistoricalOneTokenRecords: 1,
    publicTrades: publicTrades.length,
    exactPublicPlayerRoutes: publicPlayers.length,
    oneExactPublicTrade: relationshipCounts.filter(
      (row) => row.count === 1
    ).length,
    multipleExactPublicTrades: relationshipCounts.filter(
      (row) => row.count > 1
    ).length,
    zeroExactPublicTrades: relationshipCounts.filter(
      (row) => row.count === 0
    ).length,
    remainingPublicUnbalancedNames: publicUnbalanced.length,
    publicOneTokenRoutes: publicOneToken.length,
  },
  publicOneTokenSlugs,
  heldManualRelationshipRecords: [
    "bob-jackson-bobby-jackson-dean",
    "charley-ford-charlie-ford",
    "william-clay-bill-clayuncertain-billy-clayuncertain",
  ],
  errors,
};

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

if (errors.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));