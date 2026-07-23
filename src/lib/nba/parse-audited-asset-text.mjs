import { parseNbaAssetText } from "./parse-asset-text.mjs";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikePlayerName(text) {
  return /^[A-Za-zÀ-ÿ'’.]+(?:\s+[A-Za-zÀ-ÿ'’.-]+)+(?:\s+(?:Jr\.|Sr\.|II|III|IV))?$/u.test(text);
}

function parseEnhancedDraftOutcome(text) {
  const patterns = [
    /#(\d{1,3})\s*[–—-]?\s*became\s+([A-Za-zÀ-ÿ'’. -]+?)(?=\)|$)/iu,
    /#(\d{1,3})\s*[–—-]\s*([A-Za-zÀ-ÿ'’. -]+?)(?=\s+[–—-]\s*(?:from|via)\b|\)|$)/iu,
    /#(\d{1,3})\s+([A-Za-zÀ-ÿ'’. -]+?)(?=\s+[–—-]\s*(?:from|via)\b|\)|$)/iu,
  ];

  for (const pattern of patterns) {
    const match = String(text ?? "").match(pattern);
    if (match) {
      return {
        overall: Number(match[1]),
        becamePlayerName: match[2].trim(),
      };
    }
  }

  return null;
}

function parseContractPlayer(text, context) {
  const match = String(text ?? "").match(/^(.+?)\s+\(([^)]*(?:sign-and-trade|contract|yr|\$)[^)]*)\)$/iu);
  if (!match) return null;

  const playerName = match[1].trim();
  if (!looksLikePlayerName(playerName)) return null;

  return {
    type: "player",
    displayText: normalizeText(text),
    fromTeam: context.fromTeam ?? null,
    toTeam: context.toTeam ?? null,
    status: "parsed-audited",
    notes: ["Player identity separated from audited contract context."],
    playerName,
    playerAliases: [],
    contractContext: match[2].trim(),
  };
}

function expandAbbreviatedPick(text) {
  return String(text ?? "")
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh)\s+\((?=[^)]+\))/giu, "$1 round pick (")
    .replace(/\b(\d{4})\s+(first|second|third|fourth|fifth|sixth|seventh)\b(?!\s+round)/giu, "$1 $2 round pick");
}

export function parseAuditedNbaAssetText(value, context = {}) {
  const text = normalizeText(value);
  const contractPlayer = parseContractPlayer(text, context);
  if (contractPlayer) return contractPlayer;

  const expandedText = expandAbbreviatedPick(text);
  const parsed = parseNbaAssetText(expandedText, {
    ...context,
    legacyMode: true,
  });

  const enhancedOutcome = parseEnhancedDraftOutcome(text);
  const result = {
    ...parsed,
    displayText: text,
    status: parsed.status === "unclassified" ? parsed.status : "parsed-audited",
    auditSourceText: text,
  };

  if (enhancedOutcome && ["draft_pick", "draft_rights"].includes(result.type)) {
    if (result.overall == null) result.overall = enhancedOutcome.overall;
    if (!result.becamePlayerName) result.becamePlayerName = enhancedOutcome.becamePlayerName;
  }

  if (result.type === "draft_pick" && result.overall == null) {
    const overall = text.match(/#(\d{1,3})\b/);
    if (overall) result.overall = Number(overall[1]);
  }

  if (result.type === "other" && looksLikePlayerName(text.replace(/\s+\([^)]*\)$/u, ""))) {
    const playerName = text.replace(/\s+\([^)]*\)$/u, "").trim();
    return {
      ...result,
      type: "player",
      status: "parsed-audited",
      playerName,
      playerAliases: [],
      notes: [...(result.notes ?? []), "Player identity inferred from audited display text."],
    };
  }

  return result;
}
