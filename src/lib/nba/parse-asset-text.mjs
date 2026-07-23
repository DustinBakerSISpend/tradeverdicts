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

function parseDraftOutcome(text) {
  const matches = [...text.matchAll(/#(\d{1,3})-([A-Za-zÀ-ÿ'’. -]+?)(?=\)|$)/g)];
  if (matches.length === 0) return null;

  const match = matches[matches.length - 1];
  return {
    overall: Number(match[1]),
    becamePlayerName: match[2].trim(),
  };
}

function parseOverall(text) {
  const explicit = text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/i);
  if (explicit) return Number(explicit[1]);

  return parseDraftOutcome(text)?.overall ?? null;
}

function detectProtection(text) {
  const parentheticals = [...text.matchAll(/\(([^()]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((value) =>
      /protected|unprotected|top\s*\d+|lottery|less favorable|more favorable|option|if\s/i.test(value),
    );

  if (parentheticals.length > 0) return parentheticals.join("; ");

  const inline = text.match(
    /\b(top[-\s]?\d+ protected|lottery protected|protected[^,;.]*|unprotected[^,;.]*)/i,
  );
  return inline ? inline[1].trim() : null;
}

function parseCashAmount(text) {
  const match = text.match(/(?:\$|USD\s*)(~?\d+(?:\.\d+)?\s*[MK]?)/i);
  return match ? match[1].replace(/\s+/g, "") : null;
}

function parsePlayerIdentity(text) {
  const parts = text
    .split(/\s+\/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    playerName: parts[0] ?? null,
    playerAliases: parts.slice(1),
  };
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
    const identity = parsePlayerIdentity(playerMatch[1]);
    return {
      ...asset,
      type: "player",
      ...identity,
      status: "parsed",
    };
  }

  const rightsMatch = rawText.match(
    /^(?:draft\s+rights(?:\s+to)?|rights\s+to)\s*:?[\s]*(.+)$/i,
  );
  if (rightsMatch) {
    const identity = parsePlayerIdentity(rightsMatch[1]);
    return {
      ...asset,
      type: "draft_rights",
      ...identity,
      status: "parsed-partial",
    };
  }

  if (
    /\bpick\s+swap\b/i.test(rawText) ||
    /^swap\s*:/i.test(rawText) ||
    /\boption\s+to\s+swap\b/i.test(rawText)
  ) {
    return {
      ...asset,
      type: "pick_swap",
      draftYear: parseDraftYear(rawText),
      round: parseRound(rawText),
      protectionText: detectProtection(rawText),
      exercised: /not exercised/i.test(rawText)
        ? false
        : /exercised/i.test(rawText)
          ? true
          : null,
      status: "parsed-partial",
    };
  }

  if (/\btrade(?:d)?\s+player\s+exception\b/i.test(rawText) || /\bTPE\b/.test(rawText)) {
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
      amountText: parseCashAmount(rawText),
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
    const outcome = parseDraftOutcome(rawText);
    return {
      ...asset,
      type: "draft_pick",
      draftYear: parseDraftYear(rawText),
      round: parseRound(rawText),
      overall: parseOverall(rawText),
      becamePlayerName: outcome?.becamePlayerName ?? null,
      protectionText: detectProtection(rawText),
      conditional: /\bconditional\b|\bif\b|less favorable|more favorable/i.test(rawText),
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

  if (context.legacyMode === true) {
    const identity = parsePlayerIdentity(rawText);
    const looksLikePersonName =
      identity.playerName &&
      /^[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+)+$/.test(identity.playerName);

    if (looksLikePersonName) {
      return {
        ...asset,
        type: "player",
        ...identity,
        status: "inferred",
        notes: ["Player type inferred from a plain legacy asset line."],
      };
    }
  }

  return {
    ...asset,
    type: "other",
    status: "unclassified",
    notes: ["Asset type was not explicit; preserved without inference."],
  };
}
