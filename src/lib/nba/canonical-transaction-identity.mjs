import { createHash } from "node:crypto";
import { expandAuditedNbaAssetText } from "./parse-audited-asset-text.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function normalizeIdentityText(value) {
  return clean(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[–—]/gu, "-")
    .replace(/\*+/gu, "")
    .replace(/\?\s*-\s*\?/gu, "unknown")
    .replace(/\(\s*unknown\s*\)/gu, " unknown ")
    .replace(/\b(first|1st)\s*[- ]?round\b/gu, "round 1")
    .replace(/\b(second|2nd)\s*[- ]?round\b/gu, "round 2")
    .replace(/\b(third|3rd)\s*[- ]?round\b/gu, "round 3")
    .replace(/\bfourth\s*[- ]?round\b/gu, "round 4")
    .replace(/\bfifth\s*[- ]?round\b/gu, "round 5")
    .replace(/\bsixth\s*[- ]?round\b/gu, "round 6")
    .replace(/\bseventh\s*[- ]?round\b/gu, "round 7")
    .replace(/\bright(?:s)?\s+to\b/gu, "rights")
    .replace(/\bconsiderations\b/gu, "consideration")
    .replace(/[^a-z0-9#'$.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeTeamSet(teams) {
  return [...new Set((teams ?? []).map(clean).filter(Boolean))].sort();
}

export function dateTeamsKey(tradeDate, teams) {
  return `${clean(tradeDate)}|${normalizeTeamSet(teams).join("|")}`;
}

function normalizePlayerName(value) {
  return normalizeIdentityText(value)
    .replace(/\b(jr|sr)\.?$/u, "$1")
    .trim();
}

function inferredAssetType(text) {
  const value = normalizeIdentityText(text);
  if (/\btrade exception\b|\btraded player exception\b/u.test(value)) return "trade_exception";
  if (/\bcash\b|\$\d/u.test(value)) return "cash";
  if (/\bpick swap\b|\bswap rights\b|\boption to swap\b/u.test(value)) return "pick_swap";
  if (/\bdraft rights\b|^rights\s/u.test(value)) return "draft_rights";
  if (/\bround [1-7]\b|\bdraft pick\b|\bpick\b/u.test(value)) return "draft_pick";
  if (/\bfuture consideration\b|\bplayer to be named later\b|\bnothing listed\b/u.test(value)) return "future_considerations";
  if (/^[a-z][a-z'.-]+(?: [a-z][a-z'.-]+)+(?: (?:jr|sr|ii|iii|iv))?$/u.test(value)) return "player";
  return "other";
}

export function semanticTokenFromText(text, context = {}) {
  const value = clean(text);
  let parsed = null;
  try {
    parsed = expandAuditedNbaAssetText(value, {
      legacyMode: true,
      tradeDate: context.tradeDate ?? null,
      draftYear: Number(String(context.tradeDate ?? "").slice(0, 4)) || null,
      fromTeam: context.fromTeam ?? null,
      toTeam: context.toTeam ?? null,
      swapContracts: [],
    })?.[0] ?? null;
  } catch {
    parsed = null;
  }

  const type = parsed?.type && parsed.type !== "other"
    ? parsed.type
    : inferredAssetType(value);
  const normalized = normalizeIdentityText(value);

  if (type === "player") {
    const player = normalizePlayerName(parsed?.playerName ?? value.replace(/\s+\([^)]*\)$/u, ""));
    return `player:${player}`;
  }

  if (type === "draft_rights") {
    const player = normalizePlayerName(parsed?.playerName ?? normalized.replace(/^rights\s+/u, ""));
    const overall = parsed?.overall ?? (value.match(/#(\d{1,3})\b/u)?.[1] ?? "");
    return `draft_rights:${player}${overall ? `:#${overall}` : ""}`;
  }

  if (type === "draft_pick") {
    const year = parsed?.draftYear ?? value.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/u)?.[1] ?? "unknown";
    const round = parsed?.round ?? (
      /\bround 1\b/u.test(normalized) ? 1
        : /\bround 2\b/u.test(normalized) ? 2
          : /\bround 3\b/u.test(normalized) ? 3
            : null
    );
    const overall = parsed?.overall ?? value.match(/#(\d{1,3})\b/u)?.[1] ?? "";
    const became = normalizePlayerName(parsed?.becamePlayerName ?? "");
    const protection = normalizeIdentityText(parsed?.protectionText ?? normalized)
      .replace(/\b(19\d{2}|20\d{2}|21\d{2})\b/gu, " ")
      .replace(/\bround [1-7]\b/gu, " ")
      .replace(/#\d{1,3}\b/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    return [
      "draft_pick",
      year,
      round ?? "unknown",
      overall ? `#${overall}` : "",
      became ? `became:${became}` : "",
      protection ? `terms:${sha256(protection).slice(0, 10)}` : "",
    ].filter(Boolean).join(":");
  }

  if (type === "pick_swap") {
    const year = parsed?.draftYear ?? value.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/u)?.[1] ?? "unknown";
    const round = parsed?.round ?? (
      /\bround 1\b/u.test(normalized) ? 1
        : /\bround 2\b/u.test(normalized) ? 2
          : "unknown"
    );
    return `pick_swap:${year}:${round}:${sha256(normalized).slice(0, 12)}`;
  }

  if (type === "cash") {
    const amount = value.match(/\$\s*([\d,.]+)\s*([mk])?/iu);
    return amount
      ? `cash:${amount[1].replaceAll(",", "")}${(amount[2] ?? "").toLowerCase()}`
      : "cash:unspecified";
  }

  if (type === "trade_exception") {
    return `trade_exception:${sha256(normalized).slice(0, 12)}`;
  }

  if (type === "future_considerations") {
    return `future_considerations:${sha256(normalized).slice(0, 12)}`;
  }

  return `other:${sha256(normalized).slice(0, 16)}`;
}

export function semanticTokenFromCanonicalAsset(asset) {
  const type = clean(asset?.type) || inferredAssetType(asset?.displayText);

  if (type === "player") {
    return `player:${normalizePlayerName(asset.playerName ?? asset.displayText)}`;
  }
  if (type === "draft_rights") {
    const player = normalizePlayerName(asset.playerName ?? asset.becamePlayerName ?? asset.displayText);
    const overall = asset.overall ? `:#${asset.overall}` : "";
    return `draft_rights:${player}${overall}`;
  }
  if (type === "draft_pick") {
    const protection = normalizeIdentityText(asset.protectionText ?? "");
    return [
      "draft_pick",
      asset.draftYear ?? asset.declaredDraftYear ?? "unknown",
      asset.round ?? asset.declaredRound ?? "unknown",
      asset.overall ? `#${asset.overall}` : "",
      asset.becamePlayerName ? `became:${normalizePlayerName(asset.becamePlayerName)}` : "",
      protection ? `terms:${sha256(protection).slice(0, 10)}` : "",
    ].filter(Boolean).join(":");
  }
  if (type === "pick_swap") {
    return `pick_swap:${asset.draftYear ?? "unknown"}:${asset.round ?? "unknown"}:${sha256(normalizeIdentityText(asset.displayText)).slice(0, 12)}`;
  }
  if (type === "cash") return semanticTokenFromText(asset.displayText);
  if (type === "trade_exception") return semanticTokenFromText(asset.displayText);
  if (["future_considerations", "conditional_asset"].includes(type)) return semanticTokenFromText(asset.displayText);
  return semanticTokenFromText(asset.displayText);
}

function multisetCounts(values) {
  const counts = new Map();
  for (const value of values ?? []) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function multisetSimilarity(left, right) {
  const a = multisetCounts(left);
  const b = multisetCounts(right);
  const keys = new Set([...a.keys(), ...b.keys()]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const av = a.get(key) ?? 0;
    const bv = b.get(key) ?? 0;
    intersection += Math.min(av, bv);
    union += Math.max(av, bv);
  }
  return union === 0 ? 1 : intersection / union;
}

export function sourcePerspectiveIdentity(record) {
  const teams = normalizeTeamSet([record.sourceTeam, ...(record.partnerTeams ?? [])]);
  const received = (record.assetsReceivedText ?? []).map((text) => semanticTokenFromText(text, {
    tradeDate: record.tradeDate,
    toTeam: record.sourceTeam,
  })).sort();
  const sent = (record.assetsSentText ?? []).map((text) => semanticTokenFromText(text, {
    tradeDate: record.tradeDate,
    fromTeam: record.sourceTeam,
  })).sort();
  const directionless = [...received, ...sent].sort();
  const dateTeamKey = dateTeamsKey(record.tradeDate, teams);
  const sourcePerspectiveKey = `${record.sourceTeam}|${dateTeamKey}|${sha256(`received:${received.join("||")}|sent:${sent.join("||")}`).slice(0, 24)}`;
  const transactionFingerprint = `${dateTeamKey}|${sha256(directionless.join("||")).slice(0, 24)}`;
  return {
    teams,
    dateTeamsKey: dateTeamKey,
    receivedTokens: received,
    sentTokens: sent,
    directionlessTokens: directionless,
    sourcePerspectiveKey,
    transactionFingerprint,
  };
}

export function canonicalTradeIdentity(trade) {
  const teams = normalizeTeamSet(trade.teams ?? []);
  const tokens = (trade.assetLedger ?? []).map(semanticTokenFromCanonicalAsset).sort();
  return {
    id: trade.id,
    tradeDate: trade.tradeDate,
    teams,
    dateTeamsKey: trade.dateTeamsKey ?? dateTeamsKey(trade.tradeDate, teams),
    directionlessTokens: tokens,
    transactionFingerprint: `${dateTeamsKey(trade.tradeDate, teams)}|${sha256(tokens.join("||")).slice(0, 24)}`,
    canonicalKey: trade.canonicalKey ?? null,
    sourceTradeId: trade.sourceTradeId ?? null,
  };
}

function dayDifference(left, right) {
  const a = Date.parse(`${left}T00:00:00Z`);
  const b = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

function sameTeamSet(left, right) {
  const a = normalizeTeamSet(left);
  const b = normalizeTeamSet(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function compareSourceToCanonical(sourceIdentity, canonicalIdentity) {
  const exactTeams = sameTeamSet(sourceIdentity.teams, canonicalIdentity.teams);
  const deltaDays = dayDifference(sourceIdentity.tradeDate ?? sourceIdentity.dateTeamsKey.slice(0, 10), canonicalIdentity.tradeDate);
  const exactDate = deltaDays === 0;
  const similarity = multisetSimilarity(
    sourceIdentity.directionlessTokens,
    canonicalIdentity.directionlessTokens,
  );
  const sourceCore = sourceIdentity.directionlessTokens.filter((token) => token.startsWith("player:") || token.startsWith("draft_rights:"));
  const canonicalCore = canonicalIdentity.directionlessTokens.filter((token) => token.startsWith("player:") || token.startsWith("draft_rights:"));
  const coreSimilarity = multisetSimilarity(sourceCore, canonicalCore);

  let classification = "no-match";
  if (exactTeams && exactDate && similarity >= 0.72 && (coreSimilarity >= 0.5 || sourceCore.length === 0 || canonicalCore.length === 0)) {
    classification = "semantic-existing-match";
  } else if (exactTeams && exactDate) {
    classification = "date-team-collision";
  } else if (exactTeams && Math.abs(deltaDays ?? 9999) <= 3 && similarity >= 0.85) {
    classification = "probable-date-variant";
  }

  return {
    classification,
    exactTeams,
    exactDate,
    deltaDays,
    similarity: Number(similarity.toFixed(4)),
    coreSimilarity: Number(coreSimilarity.toFixed(4)),
  };
}

export function provisionalCanonicalIdentity(record, sourceIdentity) {
  const semanticKey = `${sourceIdentity.dateTeamsKey}|${sha256(sourceIdentity.directionlessTokens.join("||")).slice(0, 20)}`;
  return {
    canonicalKey: semanticKey,
    provisionalId: `nba-trade-${record.tradeDate.replaceAll("-", "")}-${sha256(semanticKey).slice(0, 12)}`,
  };
}

export function buildWithinBatchDuplicateAudit(records) {
  const standalone = records.filter((record) => ![
    "merge-followup",
    "exclude-duplicate",
    "hold-conflict",
  ].includes(record.canonicalDisposition));
  const identities = standalone.map((record) => ({ record, identity: sourcePerspectiveIdentity(record) }));
  const pairs = [];

  for (let i = 0; i < identities.length; i += 1) {
    for (let j = i + 1; j < identities.length; j += 1) {
      const left = identities[i];
      const right = identities[j];
      if (!sameTeamSet(left.identity.teams, right.identity.teams)) continue;
      const deltaDays = dayDifference(left.record.tradeDate, right.record.tradeDate);
      if (Math.abs(deltaDays ?? 9999) > 3) continue;
      const similarity = multisetSimilarity(left.identity.directionlessTokens, right.identity.directionlessTokens);
      let classification = null;
      if (left.identity.sourcePerspectiveKey === right.identity.sourcePerspectiveKey) {
        classification = "exact-source-perspective-duplicate";
      } else if (deltaDays === 0 && similarity >= 0.72) {
        classification = "probable-same-day-duplicate";
      } else if (deltaDays === 0) {
        classification = "distinct-same-day-team-collision";
      } else if (similarity >= 0.85) {
        classification = "probable-date-variant";
      }
      if (!classification) continue;
      pairs.push({
        leftTradeId: left.record.tradeId,
        rightTradeId: right.record.tradeId,
        leftDate: left.record.tradeDate,
        rightDate: right.record.tradeDate,
        teams: left.identity.teams,
        deltaDays,
        similarity: Number(similarity.toFixed(4)),
        classification,
        automaticMerge: false,
      });
    }
  }

  return pairs;
}
