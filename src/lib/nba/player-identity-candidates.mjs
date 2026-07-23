import { createHash } from "node:crypto";

export function normalizePlayerIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’'".]/gu, "")
    .replace(/&/gu, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function playerSlug(value) {
  return normalizePlayerIdentity(value).replace(/\s+/gu, "-");
}

export function playerCandidateId(value) {
  const identityKey = normalizePlayerIdentity(value);
  const suffix = createHash("sha256").update(identityKey).digest("hex").slice(0, 10);
  return `nba-player-candidate-${playerSlug(value)}-${suffix}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function makeReference(record, asset, referenceType, playerName) {
  return {
    referenceId: `${record.id}|${asset.assetId}|${referenceType}`,
    referenceType,
    playerName,
    canonicalTradeId: record.id,
    sourceTradeId: record.sourceTradeId,
    tradeDate: record.tradeDate,
    teams: record.teams,
    assetId: asset.assetId,
    assetType: asset.type,
    displayText: asset.displayText,
    direction: asset.direction,
    fromTeam: asset.fromTeam ?? null,
    toTeam: asset.toTeam ?? null,
    possibleFromTeams: asset.possibleFromTeams ?? [],
    possibleToTeams: asset.possibleToTeams ?? [],
    overall: asset.overall ?? null,
  };
}

export function extractPlayerIdentityReferences(records) {
  const references = [];

  for (const record of records) {
    for (const asset of record.assetLedger ?? []) {
      if (asset.type === "player" || asset.type === "draft_rights") {
        references.push(
          makeReference(
            record,
            asset,
            asset.type === "player" ? "direct_player" : "draft_rights",
            asset.playerName,
          ),
        );
      }

      if (asset.becamePlayerName) {
        references.push(
          makeReference(record, asset, "draft_outcome", asset.becamePlayerName),
        );
      }
    }
  }

  return references;
}

export function buildPlayerCandidates(records, aliasDocument) {
  const references = extractPlayerIdentityReferences(records);
  const aliasByPreferred = new Map(
    (aliasDocument.decisions ?? []).map((decision) => [
      decision.preferredName,
      decision,
    ]),
  );

  const groups = new Map();
  for (const reference of references) {
    const identityKey = normalizePlayerIdentity(reference.playerName);
    if (!identityKey) {
      throw new Error(`Empty player identity in ${reference.referenceId}.`);
    }

    if (!groups.has(identityKey)) {
      groups.set(identityKey, {
        identityKey,
        preferredName: reference.playerName,
        references: [],
      });
    }

    const group = groups.get(identityKey);
    if (group.preferredName !== reference.playerName) {
      throw new Error(
        `Unapproved normalized-name collision: '${group.preferredName}' and '${reference.playerName}'.`,
      );
    }
    group.references.push(reference);
  }

  const preferredKeys = new Map(
    [...groups.values()].map((group) => [group.preferredName, group.identityKey]),
  );
  const aliasOwners = new Map();

  const candidates = [...groups.values()].map((group) => {
    const decision = aliasByPreferred.get(group.preferredName);
    const aliases = uniqueSorted(decision?.aliases ?? []);

    for (const alias of aliases) {
      const aliasKey = normalizePlayerIdentity(alias);
      const existingPreferredKey = [...preferredKeys.entries()].find(
        ([, key]) => key === aliasKey,
      );
      if (
        existingPreferredKey &&
        existingPreferredKey[0] !== group.preferredName
      ) {
        throw new Error(
          `Alias '${alias}' for '${group.preferredName}' collides with preferred player '${existingPreferredKey[0]}'.`,
        );
      }

      const priorOwner = aliasOwners.get(aliasKey);
      if (priorOwner && priorOwner !== group.preferredName) {
        throw new Error(
          `Alias '${alias}' is assigned to both '${priorOwner}' and '${group.preferredName}'.`,
        );
      }
      aliasOwners.set(aliasKey, group.preferredName);
    }

    const sourceTradeIds = uniqueSorted(
      group.references.map((reference) => reference.sourceTradeId),
    );
    const canonicalTradeIds = uniqueSorted(
      group.references.map((reference) => reference.canonicalTradeId),
    );
    const referenceTypes = uniqueSorted(
      group.references.map((reference) => reference.referenceType),
    );
    const teams = uniqueSorted(
      group.references.flatMap((reference) => reference.teams),
    );

    const draftReferences = group.references
      .filter((reference) =>
        ["draft_rights", "draft_outcome"].includes(reference.referenceType),
      )
      .map((reference) => ({
        referenceType: reference.referenceType,
        sourceTradeId: reference.sourceTradeId,
        tradeDate: reference.tradeDate,
        overall: reference.overall,
        displayText: reference.displayText,
      }));

    return {
      candidateId: playerCandidateId(group.preferredName),
      league: "nba",
      preferredName: group.preferredName,
      normalizedName: group.identityKey,
      slug: playerSlug(group.preferredName),
      aliases,
      aliasDecision: decision
        ? {
            reason: decision.reason,
            sourceTradeIds: decision.sourceTradeIds,
          }
        : null,
      referenceCount: group.references.length,
      sourceTradeCount: sourceTradeIds.length,
      sourceTradeIds,
      canonicalTradeIds,
      referenceTypes,
      teams,
      draftReferences,
      sourceReferences: group.references.sort((left, right) =>
        left.referenceId.localeCompare(right.referenceId, "en"),
      ),
      identityStatus: "source-derived-candidate",
      externalIdentityStatus: "unverified",
      candidateDataReady: true,
      playerImportReady: false,
      playerImportPerformed: false,
      automaticMerge: false,
      publishStatus: "private",
      reviewStatus: "manual-review",
      indexEligible: false,
      adEligible: false,
      publicationReady: false,
    };
  });

  candidates.sort((left, right) =>
    left.preferredName.localeCompare(right.preferredName, "en"),
  );

  const excludedAliasValues = new Set(
    (aliasDocument.excludedAliases ?? []).map((entry) =>
      normalizePlayerIdentity(entry.excludedValue),
    ),
  );

  for (const candidate of candidates) {
    for (const alias of candidate.aliases) {
      if (excludedAliasValues.has(normalizePlayerIdentity(alias))) {
        throw new Error(`Excluded alias leaked into player candidates: ${alias}`);
      }
    }
  }

  return {
    references,
    candidates,
    aliasDecisionCount: aliasByPreferred.size,
    aliasValueCount: candidates.reduce(
      (sum, candidate) => sum + candidate.aliases.length,
      0,
    ),
  };
}
