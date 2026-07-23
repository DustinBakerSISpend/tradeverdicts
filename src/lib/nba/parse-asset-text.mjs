const ROUND_WORDS = new Map([
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
]);

function clean(value) {
  return String(value ?? "").replace(/^[-•]\s*/, "").trim();
}

function parseRound(text) {
  const numeric = text.match(/\b([1-7])(?:st|nd|rd|th)?[-\s]?round\b/i);
  if (numeric) return Number(numeric[1]);

  for (const [word, round] of ROUND_WORDS) {
    if (new RegExp(`\\b${word}[-\\s]?round\\b`, "i").test(text)) {
      return round;
    }
  }

  return null;
}

function parseDraftYear(text) {
  const match = text.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function parseOverall(text) {
  const match = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/i);
  return match ? Number(match[1]) : null;
}

function detectProtection(text) {
  const match = text.match(/\b(top[-\s]?\d+ protected|lottery protected|protected[^,;.]*)/i);
  return match ? match[1].trim() : null;
}

function baseAsset(rawText, context) {
  return {
    type: "other",
    displayText: rawText,
    fromTeam: context.fromTeam ?? null,
    toTeam: context.toTeam ?? null,
    status: "unclassified",
    notes: [],
  };
}

export function parseNbaAssetText(value, context = {}) {
  const rawText = clean(value);
  const lower = rawText.toLowerCase();
  const asset = baseAsset(rawText, context);

  if (!rawText) {
    return {
      ...asset,
      status: "invalid",
      notes: ["Empty asset text."],
    };
  }

  const playerMatch = rawText.match(/^player\s*:\s*(.+)$/i);
  if (playerMatch) {
    return {
      ...asset,
      type: "player",
      playerName: playerMatch[1].trim(),
      status: "parsed",
    };
  }

  if (/\bpick\s+swap\b/i.test(rawText) || /^swap\s*:/i.test(rawText)) {
    return {
      ...asset,
      type: "pick_swap",
      draftYear: parseDraftYear(rawText),
      round: parseRound(rawText),
      protectionText: detectProtection(rawText),
      status: "parsed-partial",
    };
  }

  if (/\bdraft\s+rights\b/i.test(rawText)) {
    const rightsMatch = rawText.match(/draft\s+rights(?:\s+to)?\s*:?\s*(.+)$/i);
    return {
      ...asset,
      type: "draft_rights",
      playerName: rightsMatch?.[1]?.trim() || null,
      status: "parsed-partial",
    };
  }

  if (/\btrade\s+exception\b/i.test(rawText) || /\bTPE\b/.test(rawText)) {
    return {
      ...asset,
      type: "trade_exception",
      status: "parsed-partial",
    };
  }

  if (/\bcash\b/i.test(rawText)) {
    return {
      ...asset,
      type: "cash",
      status: "parsed-partial",
    };
  }

  if (/\bfuture\s+considerations?\b/i.test(rawText)) {
    return {
      ...asset,
      type: "future_consideration",
      status: "parsed-partial",
    };
  }

  const looksLikePick = /\b(?:draft\s+pick|round\s+pick|rounder|first[-\s]round|second[-\s]round|third[-\s]round|fourth[-\s]round|fifth[-\s]round|sixth[-\s]round|seventh[-\s]round|[1-7](?:st|nd|rd|th)[-\s]round)\b/i.test(rawText);

  if (looksLikePick) {
    return {
      ...asset,
      type: "draft_pick",
      draftYear: parseDraftYear(rawText),
      round: parseRound(rawText),
      overall: parseOverall(rawText),
      protectionText: detectProtection(rawText),
      conditional: /\bconditional\b/i.test(rawText),
      status: "parsed-partial",
    };
  }

  if (/\bconditional\b/i.test(rawText)) {
    return {
      ...asset,
      type: "conditional_asset",
      status: "parsed-partial",
    };
  }

  return {
    ...asset,
    type: "other",
    status: "unclassified",
    notes: ["Asset type was not explicit; preserved without inference."],
  };
}
