import fs from "node:fs";
import path from "node:path";
import {
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
} from "../../src/utils/publicRecords.js";

const repo = process.cwd();
const outputPath = process.argv[2];
const repairs = [
  {
    "slug": "greg-bell-leon",
    "before": "Greg Bell (Leon",
    "after": "Greg Bell (Leon)"
  },
  {
    "slug": "billy-frank-parker",
    "before": "Billy) Frank Parker",
    "after": "(Billy) Frank Parker"
  },
  {
    "slug": "earl-jack-gregory",
    "before": "Earl) Jack Gregory",
    "after": "(Earl) Jack Gregory"
  },
  {
    "slug": "herschel-ray-jacobs",
    "before": "Herschel) Ray Jacobs",
    "after": "(Herschel) Ray Jacobs"
  },
  {
    "slug": "james-mike-montgomery",
    "before": "James) Mike Montgomery",
    "after": "(James) Mike Montgomery"
  },
  {
    "slug": "paul-eddie-brown",
    "before": "Paul) Eddie Brown",
    "after": "(Paul) Eddie Brown"
  },
  {
    "slug": "ralph-marty-huff",
    "before": "Ralph) Marty Huff",
    "after": "(Ralph) Marty Huff"
  },
  {
    "slug": "richard-dave-robinson",
    "before": "Richard) Dave Robinson",
    "after": "(Richard) Dave Robinson"
  },
  {
    "slug": "william-larry-smith",
    "before": "William) Larry Smith",
    "after": "(William) Larry Smith"
  },
  {
    "slug": "william-mike-evans",
    "before": "William) Mike Evans",
    "after": "(William) Mike Evans"
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
const publicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);

const errors = [];

for (const repair of repairs) {
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

  if (
    players.some(
      (player) =>
        player.slug === repair.slug &&
        player.name === repair.before
    )
  ) {
    errors.push(
      `${repair.slug}: original malformed name remains.`
    );
  }

  const player = matches[0];
  const openCount = (
    String(player.name).match(/\(/g) || []
  ).length;
  const closeCount = (
    String(player.name).match(/\)/g) || []
  ).length;

  if (openCount !== closeCount) {
    errors.push(
      `${repair.slug}: repaired name remains unbalanced.`
    );
  }

  const related = getRelatedPublicTrades(
    player,
    publicTrades
  );

  if (related.length === 0) {
    errors.push(
      `${repair.slug}: repaired player lost all exact public relationships.`
    );
  }
}

const unbalancedPublicPlayers = publicPlayers.filter(
  (player) => {
    const name = String(player?.name || "");
    return (
      (name.match(/\(/g) || []).length !==
      (name.match(/\)/g) || []).length
    );
  }
);

const exactNames = new Map();

for (const player of players) {
  const name = String(player?.name || "").trim();

  if (!name) continue;

  if (!exactNames.has(name)) {
    exactNames.set(name, []);
  }

  exactNames.get(name).push(player.slug);
}

const repairedNameCollisions = repairs
  .map((repair) => ({
    name: repair.after,
    slugs: exactNames.get(repair.after) || [],
  }))
  .filter((row) => row.slugs.length !== 1);

if (repairedNameCollisions.length > 0) {
  errors.push(
    `${repairedNameCollisions.length} repaired names have exact-name collisions.`
  );
}

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    repairsApplied: repairs.length,
    publicTrades: publicTrades.length,
    exactPublicPlayerRoutes: publicPlayers.length,
    remainingPublicUnbalancedParentheses:
      unbalancedPublicPlayers.length,
    repairedNameCollisions:
      repairedNameCollisions.length,
  },
  repairedRoutes: repairs.map((repair) => ({
    slug: repair.slug,
    before: repair.before,
    after: repair.after,
  })),
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