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
const displayRepairs = [
  {
    "slug": "ben-smith-a",
    "before": "Ben Smith (a",
    "after": "Ben Smith (a)",
    "evidenceTradeSlug": "ben-smith-a-green-bay-packers-1934"
  },
  {
    "slug": "bill-butler-a",
    "before": "Bill Butler (a",
    "after": "Bill Butler (a)",
    "evidenceTradeSlug": "bill-butler-a-dallas-cowboys-1960"
  },
  {
    "slug": "charlie-brown-d",
    "before": "Charlie Brown (d",
    "after": "Charlie Brown (d)",
    "evidenceTradeSlug": "r-c-theilmann-r-c-thielemann-r-c-thieemann-atlanta-falcons-1985"
  },
  {
    "slug": "charlie-johnson-a",
    "before": "Charlie Johnson (a",
    "after": "Charlie Johnson (a)",
    "evidenceTradeSlug": "charlie-johnson-a-philadelphia-eagles-1982"
  },
  {
    "slug": "don-king-a",
    "before": "Don King (a",
    "after": "Don King (a)",
    "evidenceTradeSlug": "art-hauser-boston-new-england-patriots-1961"
  },
  {
    "slug": "don-smith-loren",
    "before": "Don Smith (Loren",
    "after": "Don Smith (Loren)",
    "evidenceTradeSlug": "1986-sixth-round-pick-154-floyd-dixon-buffalo-bills-1985"
  },
  {
    "slug": "jim-hill-webster",
    "before": "Jim Hill (Webster",
    "after": "Jim Hill (Webster)",
    "evidenceTradeSlug": "unspecified-consideration-green-bay-packers-1972"
  },
  {
    "slug": "john-baker-haywood",
    "before": "John Baker (Haywood",
    "after": "John Baker (Haywood)",
    "evidenceTradeSlug": "john-baker-haywood-philadelphia-eagles-1962"
  },
  {
    "slug": "john-stephens-milton",
    "before": "John Stephens (Milton",
    "after": "John Stephens (Milton)",
    "evidenceTradeSlug": "john-stephens-milton-new-england-patriots-1993"
  },
  {
    "slug": "roy-williams-b",
    "before": "Roy Williams (b",
    "after": "Roy Williams (b)",
    "evidenceTradeSlug": "draft-pick-trade-san-francisco-49ers-1963"
  },
  {
    "slug": "steve-young-a",
    "before": "Steve Young (a",
    "after": "Steve Young (offensive tackle)",
    "evidenceTradeSlug": "mike-current-buccaneers-1977"
  }
];
const duplicateMerges = [
  {
    "duplicateSlug": "brodrick-bunkley-voided-due-to-failed-physical",
    "duplicateName": "Brodrick Bunkley (voided due to failed physical",
    "canonicalSlug": "brodrick-bunkley",
    "canonicalName": "Brodrick Bunkley",
    "tradeSlug": "brodrick-bunkley-voided-due-to-failed-physical-philadelphia-eagles-2011-376"
  },
  {
    "duplicateSlug": "jerome-harrison-trade-voided-due-to-failed-physical",
    "duplicateName": "Jerome Harrison (Trade voided due to failed physical",
    "canonicalSlug": "jerome-harrison",
    "canonicalName": "Jerome Harrison",
    "tradeSlug": "ronnie-brown-philadelphia-eagles-2012-10-18"
  }
];

const players = JSON.parse(
  fs
    .readFileSync(
      path.join(
        repo,
        "src/data/nfl/players.json"
      ),
      "utf8"
    )
    .replace(/^\uFEFF/, "")
);
const trades = JSON.parse(
  fs
    .readFileSync(
      path.join(
        repo,
        "src/data/nfl/trades.json"
      ),
      "utf8"
    )
    .replace(/^\uFEFF/, "")
);

const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);
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
      `${repair.slug}: expected one repaired player, found ${matches.length}.`
    );
    continue;
  }

  const name = matches[0].name;
  const openCount = (
    String(name).match(/\(/g) || []
  ).length;
  const closeCount = (
    String(name).match(/\)/g) || []
  ).length;

  if (openCount !== closeCount) {
    errors.push(
      `${repair.slug}: target name remains unbalanced.`
    );
  }

  if (
    !publicPlayerSlugSet.has(repair.slug)
  ) {
    errors.push(
      `${repair.slug}: repaired route is no longer public.`
    );
  }
}

for (const merge of duplicateMerges) {
  const duplicateMatches = players.filter(
    (player) =>
      player.slug === merge.duplicateSlug
  );
  const canonicalMatches = players.filter(
    (player) =>
      player.slug === merge.canonicalSlug
  );

  if (duplicateMatches.length !== 1) {
    errors.push(
      `${merge.duplicateSlug}: duplicate record count is ${duplicateMatches.length}.`
    );
    continue;
  }

  if (canonicalMatches.length !== 1) {
    errors.push(
      `${merge.canonicalSlug}: canonical record count is ${canonicalMatches.length}.`
    );
    continue;
  }

  const duplicate = duplicateMatches[0];
  const canonical = canonicalMatches[0];

  if (duplicate.suppressed !== true) {
    errors.push(
      `${merge.duplicateSlug}: duplicate is not suppressed.`
    );
  }

  if (
    duplicate.suppressionReason !==
    "merged-trade-note-duplicate"
  ) {
    errors.push(
      `${merge.duplicateSlug}: suppression reason mismatch.`
    );
  }

  if (
    duplicate.canonicalPlayerSlug !==
    merge.canonicalSlug
  ) {
    errors.push(
      `${merge.duplicateSlug}: canonical-player pointer mismatch.`
    );
  }

  if (isPublicPlayerRecord(duplicate)) {
    errors.push(
      `${merge.duplicateSlug}: duplicate remains a public player record.`
    );
  }

  if (
    publicPlayerSlugSet.has(
      merge.duplicateSlug
    )
  ) {
    errors.push(
      `${merge.duplicateSlug}: duplicate route remains public.`
    );
  }

  if (
    !canonical.tradeSlugs.includes(
      merge.tradeSlug
    )
  ) {
    errors.push(
      `${merge.canonicalSlug}: merged tradeSlug is missing.`
    );
  }

  const related = getRelatedPublicTrades(
    canonical,
    publicTrades
  );

  if (
    !related.some(
      (trade) =>
        trade.slug === merge.tradeSlug
    )
  ) {
    errors.push(
      `${merge.canonicalSlug}: merged trade is not returned as related.`
    );
  }
}

const unbalancedPublicPlayers =
  publicPlayers.filter((player) => {
    const name = String(player?.name || "");

    return (
      (name.match(/\(/g) || []).length !==
      (name.match(/\)/g) || []).length
    );
  });

const relationshipCounts = publicPlayers.map(
  (player) => ({
    slug: player.slug,
    count: getRelatedPublicTrades(
      player,
      publicTrades
    ).length,
  })
);

const summary = {
  generatedAt: new Date().toISOString(),
  status:
    errors.length === 0
      ? "PASSED"
      : "FAILED",
  counts: {
    displayRepairsApplied:
      displayRepairs.length,
    tradeNoteDuplicatesMerged:
      duplicateMerges.length,
    publicTrades: publicTrades.length,
    exactPublicPlayerRoutes:
      publicPlayers.length,
    oneExactPublicTrade:
      relationshipCounts.filter(
        (row) => row.count === 1
      ).length,
    multipleExactPublicTrades:
      relationshipCounts.filter(
        (row) => row.count > 1
      ).length,
    zeroExactPublicTrades:
      relationshipCounts.filter(
        (row) => row.count === 0
      ).length,
    remainingPublicUnbalancedParentheses:
      unbalancedPublicPlayers.length,
  },
  repairedDisplayRoutes:
    displayRepairs.map((repair) => ({
      slug: repair.slug,
      before: repair.before,
      after: repair.after,
    })),
  mergedDuplicateRoutes:
    duplicateMerges.map((merge) => ({
      duplicateSlug: merge.duplicateSlug,
      canonicalSlug: merge.canonicalSlug,
      tradeSlug: merge.tradeSlug,
    })),
  errors,
};

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

if (errors.length > 0) {
  console.error(
    JSON.stringify(summary, null, 2)
  );
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));