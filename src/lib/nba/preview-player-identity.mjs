import { createHash } from "node:crypto";
import {
  normalizePlayerIdentity,
  playerCandidateId,
  playerSlug,
} from "./player-identity-candidates.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

const PLACEHOLDER_PATTERNS = [
  /^player to be named later$/u,
  /^future (?:draft )?considerations?$/u,
  /^draft pick$/u,
  /^(?:conditional )?(?:first|second|third|fourth|fifth|sixth|seventh) round pick$/u,
  /^aba dispersal draft first round pick$/u,
  /^unknown$/u,
  /^nothing listed$/u,
  /\b(?:traded player|trade) exception\b/u,
  /^tpe$/u,
  /\bright of first refusal\b/u,
];

export function isNonPlayerPlaceholder(value) {
  const normalized = normalizePlayerIdentity(value);
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function deriveIdentityName(playerName, displayText) {
  const rawName = clean(playerName).replace(/^(?:draft )?rights to\s+/iu, "");
  const display = clean(displayText).replace(/^(?:draft )?rights to\s+/iu, "");
  const escaped = rawName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = display.match(new RegExp(`^${escaped}\\s*\\(([^()]*)\\)\\s*$`, "iu"));
  const qualifier = clean(match?.[1]);
  if (!qualifier || qualifier === "?" || /^(?:rights to|#|\d{4}\b)/iu.test(qualifier)) {
    return { preferredName: rawName, identityQualifier: null };
  }
  return {
    preferredName: `${rawName} (${qualifier})`,
    identityQualifier: qualifier,
  };
}

function referenceKey(reference) {
  return [
    reference.canonicalTradeId,
    reference.sourceTradeId,
    reference.assetId,
    reference.referenceType,
    reference.normalizedName,
  ].join("|");
}

export function buildExistingIdentityIndex(players) {
  const owners = new Map();
  const collisions = [];

  for (const player of players) {
    const values = uniqueSorted([
      player.name,
      player.normalizedName,
      ...(player.aliases ?? []),
    ]);

    for (const value of values) {
      const key = normalizePlayerIdentity(value);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(player.id);
    }
  }

  for (const [normalizedName, ids] of owners) {
    if (ids.size > 1) {
      collisions.push({
        normalizedName,
        playerIds: [...ids].sort(),
        collisionType: "existing-store-identity-collision",
      });
    }
  }

  return {
    owners,
    collisions,
  };
}

export function extractPreviewPlayerReferences(previewRecords) {
  const references = [];

  for (const record of previewRecords) {
    if (record.candidateAction === "exclude-from-standalone-canonical-preview") {
      continue;
    }

    const canonicalTradeId =
      record.existingCanonicalMatch ?? record.provisionalCanonicalId;

    for (const asset of record.assetLedger ?? []) {
      const base = {
        canonicalTradeId,
        provisionalCanonicalId: record.provisionalCanonicalId,
        existingCanonicalMatch: record.existingCanonicalMatch ?? null,
        sourceTradeId: record.sourceTradeId,
        tradeDate: record.tradeDate,
        teams: record.teams,
        sourceTeam: record.sourceTeam,
        candidateAction: record.candidateAction,
        canonicalDataReady: record.canonicalDataReady,
        assetId: asset.assetId,
        assetType: asset.type,
        displayText: asset.displayText,
        direction: asset.direction,
        fromTeam: asset.fromTeam ?? null,
        toTeam: asset.toTeam ?? null,
        possibleFromTeams: asset.possibleFromTeams ?? [],
        possibleToTeams: asset.possibleToTeams ?? [],
      };

      if (asset.type === "player" || asset.type === "draft_rights") {
        const sourcePlayerName = clean(asset.playerName);
        const derived = deriveIdentityName(sourcePlayerName, asset.displayText);
        const playerName = derived.preferredName;
        const normalizedName = normalizePlayerIdentity(playerName);
        references.push({
          ...base,
          playerName,
          sourcePlayerName,
          identityQualifier: derived.identityQualifier,
          normalizedName,
          referenceType:
            asset.type === "player" ? "direct_player" : "draft_rights",
          placeholder: isNonPlayerPlaceholder(sourcePlayerName),
        });
      }

      if (asset.becamePlayerName) {
        const sourcePlayerName = clean(asset.becamePlayerName);
        const playerName = sourcePlayerName;
        const normalizedName = normalizePlayerIdentity(playerName);
        references.push({
          ...base,
          playerName,
          sourcePlayerName,
          identityQualifier: null,
          normalizedName,
          referenceType: "draft_outcome",
          placeholder: isNonPlayerPlaceholder(sourcePlayerName),
        });
      }
    }
  }

  for (const reference of references) {
    reference.referenceKey = referenceKey(reference);
  }

  return references;
}

function choosePreferredName(references) {
  const counts = new Map();
  for (const reference of references) {
    counts.set(reference.playerName, (counts.get(reference.playerName) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"),
  )[0][0];
}

export function buildPreviewPlayerIdentityPlan({ previewRecords, players }) {
  const references = extractPreviewPlayerReferences(previewRecords);
  const existingIndex = buildExistingIdentityIndex(players);
  const playerById = new Map(players.map((player) => [player.id, player]));
  const validReferences = references.filter((reference) => !reference.placeholder);
  const placeholderReferences = references.filter((reference) => reference.placeholder);
  const groups = new Map();

  for (const reference of validReferences) {
    if (!reference.normalizedName) {
      throw new Error(`Empty normalized player identity: ${reference.referenceKey}`);
    }
    if (!groups.has(reference.normalizedName)) groups.set(reference.normalizedName, []);
    groups.get(reference.normalizedName).push(reference);
  }

  const identities = [];
  const identityCollisions = [...existingIndex.collisions];
  const newCandidateIds = new Set();
  const newCandidateSlugs = new Set();

  for (const [normalizedName, groupReferences] of groups) {
    const preferredName = choosePreferredName(groupReferences);
    const sourceVariants = uniqueSorted(groupReferences.map((reference) => reference.playerName));
    const existingIds = [...(existingIndex.owners.get(normalizedName) ?? new Set())].sort();
    const sourceTradeIds = uniqueSorted(groupReferences.map((reference) => reference.sourceTradeId));
    const canonicalTradeIds = uniqueSorted(groupReferences.map((reference) => reference.canonicalTradeId));
    const teams = uniqueSorted(groupReferences.flatMap((reference) => reference.teams));
    const referenceTypes = uniqueSorted(groupReferences.map((reference) => reference.referenceType));
    const years = uniqueSorted(groupReferences.map((reference) => reference.tradeDate.slice(0, 4)));

    let identityAction;
    let existingPlayerId = null;
    let provisionalPlayerId = null;
    const blockers = [];

    if (existingIds.length === 1) {
      identityAction = "match-existing-player";
      existingPlayerId = existingIds[0];
    } else if (existingIds.length > 1) {
      identityAction = "hold-existing-identity-collision";
      blockers.push(`Normalized identity maps to multiple existing players: ${existingIds.join(", ")}`);
      identityCollisions.push({
        normalizedName,
        sourceVariants,
        playerIds: existingIds,
        sourceTradeIds,
        collisionType: "source-to-existing-multiple-owners",
      });
    } else {
      identityAction = "create-new-player-preview";
      provisionalPlayerId = playerCandidateId(preferredName).replace(
        "nba-player-candidate-",
        "nba-player-",
      );
      const slug = playerSlug(preferredName);
      if (newCandidateIds.has(provisionalPlayerId)) {
        blockers.push(`Duplicate provisional player ID: ${provisionalPlayerId}`);
      }
      if (newCandidateSlugs.has(slug)) {
        blockers.push(`Duplicate provisional player slug: ${slug}`);
      }
      newCandidateIds.add(provisionalPlayerId);
      newCandidateSlugs.add(slug);
    }

    if (sourceVariants.length > 1) {
      blockers.push(`Source-name variants require alias review: ${sourceVariants.join(" | ")}`);
    }

    const minYear = Math.min(...years.map(Number));
    const maxYear = Math.max(...years.map(Number));
    const directYears = uniqueSorted(
      groupReferences
        .filter((reference) => reference.referenceType === "direct_player")
        .map((reference) => reference.tradeDate.slice(0, 4)),
    ).map(Number);
    if (directYears.length > 1 && Math.max(...directYears) - Math.min(...directYears) >= 20) {
      blockers.push(`Direct-player references span ${Math.min(...directYears)}-${Math.max(...directYears)}; confirm no same-name player collision.`);
    }

    const existingPlayer = existingPlayerId ? playerById.get(existingPlayerId) : null;
    const importReady =
      identityAction === "create-new-player-preview" &&
      blockers.length === 0 &&
      groupReferences.every((reference) => reference.canonicalDataReady) &&
      groupReferences.every((reference) => !reference.existingCanonicalMatch);

    identities.push({
      normalizedName,
      preferredName,
      sourceVariants,
      identityAction,
      existingPlayerId,
      existingPlayerName: existingPlayer?.name ?? null,
      provisionalPlayerId,
      slug: playerSlug(preferredName),
      referenceCount: groupReferences.length,
      sourceTradeCount: sourceTradeIds.length,
      sourceTradeIds,
      canonicalTradeIds,
      teams,
      referenceTypes,
      yearRange: `${minYear}-${maxYear}`,
      blockers,
      playerDataReady: importReady,
      automaticMerge: false,
      externalIdentityStatus: "unverified",
      publishStatus: "private",
      reviewStatus: blockers.length === 0 ? "preview-complete" : "manual-review",
      indexEligible: false,
      adEligible: false,
      sourceReferences: groupReferences.sort((left, right) =>
        left.referenceKey.localeCompare(right.referenceKey, "en"),
      ),
    });
  }

  identities.sort((left, right) =>
    left.preferredName.localeCompare(right.preferredName, "en"),
  );

  const referenceKeys = validReferences.map((reference) => reference.referenceKey);
  const duplicateReferenceKeys = referenceKeys.filter(
    (value, index) => referenceKeys.indexOf(value) !== index,
  );

  return {
    references,
    validReferences,
    placeholderReferences,
    identities,
    identityCollisions,
    duplicateReferenceKeys: uniqueSorted(duplicateReferenceKeys),
    hashes: {
      identityPlanSha256: sha256(JSON.stringify(identities)),
    },
  };
}
