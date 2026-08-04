import { buildPrivateQueryIndex } from "./build-private-query-index.mjs";

export const NBA_PLAYER_DIRECTORY_PAGE_SIZE = 120;

const ASSET_LIKE_NAME_RULES = Object.freeze([
  /^(?:18|19|20)\d{2}\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+round\s+pick\b/iu,
  /\b(?:draft|future|conditional|protected|unprotected)\s+(?:first|second|third|fourth|fifth|sixth|seventh|round|pick)\b/iu,
  /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+round\s+pick\b/iu,
  /(?:^|\s)(?:pick\s*)?#\d+\b/iu,
  /\b(?:pick swap|swap rights?)\b/iu,
  /\bcash considerations?\b/iu,
  /\btrade exception\b/iu,
  /\bplayer to be named\b/iu,
  /\bdraft rights?\b/iu,
  /\bfuture considerations?\b/iu,
]);

const clean = (value = "") =>
  String(value ?? "").trim().replace(/\s+/gu, " ");

export function isNbaPlayerDirectoryAssetLike(record) {
  const name = clean(record?.name);

  return ASSET_LIKE_NAME_RULES.some((rule) => rule.test(name));
}

export function getNbaPlayerLastInitial(name) {
  const directoryName = clean(name).replace(
    /\s*\([^()]*\)\s*$/u,
    "",
  );
  const parts = directoryName
    .split(/\s+/gu)
    .filter(Boolean);
  const last = parts.at(-1) ?? "";
  const initial = last
    .normalize("NFKD")
    .replace(/[^\p{L}]/gu, "")
    .charAt(0)
    .toUpperCase();

  return /^[A-Z]$/u.test(initial) ? initial : "";
}

export function createNbaPlayerDirectoryRows({
  players = [],
  trades = [],
  teams = [],
}) {
  if (
    !Array.isArray(players) ||
    !Array.isArray(trades) ||
    !Array.isArray(teams)
  ) {
    throw new TypeError(
      "createNbaPlayerDirectoryRows requires player, trade, and team arrays.",
    );
  }

  const queryIndex = buildPrivateQueryIndex({
    players,
    trades,
    teams,
  });

  return players
    .filter((player) => !isNbaPlayerDirectoryAssetLike(player))
    .map((player) => {
      const name = clean(player.name);
      const slug = clean(player.slug);
      const tradeIds =
        queryIndex.indexes.tradeIdsByPlayer[player.id] ?? [];

      return {
        id: clean(player.id),
        name,
        slug,
        lastInitial: getNbaPlayerLastInitial(name),
        tradeCount: tradeIds.length,
      };
    })
    .filter(
      (player) =>
        player.id &&
        player.name &&
        player.slug &&
        player.lastInitial &&
        player.tradeCount > 0,
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en") ||
        left.slug.localeCompare(right.slug, "en"),
    );
}

export function getNbaPlayerDirectoryTotalPages(
  rows = [],
  pageSize = NBA_PLAYER_DIRECTORY_PAGE_SIZE,
) {
  return Math.max(1, Math.ceil(rows.length / pageSize));
}

export function getNbaPlayerDirectoryPage(
  rows = [],
  page = 1,
  pageSize = NBA_PLAYER_DIRECTORY_PAGE_SIZE,
) {
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * pageSize;

  return rows.slice(start, start + pageSize);
}

export function getNbaPlayerDirectoryPageHref(page) {
  const safePage = Math.max(1, Number(page) || 1);

  return safePage === 1
    ? "/nba/players/"
    : `/nba/players/page/${safePage}/`;
}

export function auditNbaPlayerDirectory({
  players = [],
  trades = [],
  teams = [],
}) {
  const queryIndex = buildPrivateQueryIndex({
    players,
    trades,
    teams,
  });
  const rows = createNbaPlayerDirectoryRows({
    players,
    trades,
    teams,
  });
  const sourceRows = players.map((player) => {
    const tradeIds =
      queryIndex.indexes.tradeIdsByPlayer[player.id] ?? [];

    return {
      id: clean(player.id),
      name: clean(player.name),
      slug: clean(player.slug),
      assetLike:
        isNbaPlayerDirectoryAssetLike(player),
      tradeCount: tradeIds.length,
    };
  });
  const assetLikeRecords = sourceRows
    .filter((player) => player.assetLike)
    .map(({ id, name, slug, tradeCount }) => ({
      id,
      name,
      slug,
      tradeCount,
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
  const personLikeRecords = sourceRows.filter(
    (player) => !player.assetLike,
  );
  const personLikeWithoutTradeRecords =
    personLikeRecords
      .filter((player) => player.tradeCount < 1)
      .map(({ id, name, slug, tradeCount }) => ({
        id,
        name,
        slug,
        tradeCount,
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
      );
  const duplicateSlugs = rows
    .map((row) => row.slug)
    .filter(
      (slug, index, values) =>
        values.indexOf(slug) !== index,
    );
  const duplicateNames = rows
    .map((row) => row.name.toLowerCase())
    .filter(
      (name, index, values) =>
        values.indexOf(name) !== index,
    );

  return {
    sourceRecords: players.length,
    personLikeSourceRecords:
      personLikeRecords.length,
    directoryRecords: rows.length,
    relationshipLinkedSourceRecords:
      sourceRows.filter((player) => player.tradeCount > 0)
        .length,
    assetLikeRecords,
    assetLikeRecordCount:
      assetLikeRecords.length,
    assetLikeWithTradeCount:
      assetLikeRecords.filter(
        (player) => player.tradeCount > 0,
      ).length,
    personLikeWithoutTradeRecords,
    personLikeWithoutTradeCount:
      personLikeWithoutTradeRecords.length,
    totalPages:
      getNbaPlayerDirectoryTotalPages(rows),
    firstPageCount:
      getNbaPlayerDirectoryPage(rows, 1).length,
    lastPageCount: getNbaPlayerDirectoryPage(
      rows,
      getNbaPlayerDirectoryTotalPages(rows),
    ).length,
    recordsWithoutTrades: rows.filter(
      (row) => row.tradeCount < 1,
    ).length,
    duplicateSlugs: [...new Set(duplicateSlugs)],
    duplicateNames: [...new Set(duplicateNames)],
  };
}
