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

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort(
    (a, b) => a - b,
  );
}

function parseRoundFromText(text) {
  const numeric = text.match(/\b([1-7])(?:st|nd|rd|th)?[-\s]?round\b/i);
  if (numeric) return Number(numeric[1]);

  for (const [word, round] of ROUND_WORDS) {
    if (new RegExp(`\\b${word}[-\\s]?round\\b`, "i").test(text)) {
      return round;
    }
  }

  return null;
}

function parseAllRounds(text) {
  const rounds = [];

  for (const match of text.matchAll(/\b([1-7])(?:st|nd|rd|th)?[-\s]?round\b/gi)) {
    rounds.push(Number(match[1]));
  }

  for (const [word, round] of ROUND_WORDS) {
    if (new RegExp(`\\b${word}[-\\s]?round\\b`, "i").test(text)) {
      rounds.push(round);
    }
  }

  return uniqueNumbers(rounds);
}

function parseDeclaredRound(text) {
  const prefix = String(text ?? "").split("(")[0];
  return parseRoundFromText(prefix);
}

function parseAllDraftYears(text) {
  return uniqueNumbers(
    [...String(text ?? "").matchAll(/\b(19\d{2}|20\d{2}|21\d{2})\b/g)].map(
      (match) => Number(match[1]),
    ),
  );
}

function parseDeclaredDraftYear(text) {
  const match = String(text ?? "").match(/^\s*(19\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function parseDraftOutcome(text) {
  const matches = [
    ...String(text ?? "").matchAll(
      /\((?:(19\d{2}|20\d{2}|21\d{2})\s+)?#(\d{1,3})-([A-Za-zÀ-ÿ'’. -]+?)(?=\)|$)/g,
    ),
  ];

  if (matches.length === 0) return null;

  const match = matches[matches.length - 1];
  return {
    conveyedYear: match[1] ? Number(match[1]) : null,
    overall: Number(match[2]),
    becamePlayerName: match[3].trim(),
  };
}

function parseOverall(text) {
  const explicit = String(text ?? "").match(
    /\b(\d{1,3})(?:st|nd|rd|th)?\s+overall\b/i,
  );
  if (explicit) return Number(explicit[1]);

  return parseDraftOutcome(text)?.overall ?? null;
}

function detectProtection(text) {
  const parentheticals = [...String(text ?? "").matchAll(/\(([^()]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((value) =>
      /protected|unprotected|top\s*\d+|lottery|less favorable|more favorable|option|if\s|else\s/i.test(
        value,
      ),
    );

  if (parentheticals.length > 0) return parentheticals.join("; ");

  const inline = String(text ?? "").match(
    /\b(top[-\s]?\d+ protected|lottery protected|protected[^,;.]*|unprotected[^,;.]*|less favorable[^;.]*|more favorable[^;.]*)/i,
  );
  return inline ? inline[1].trim() : null;
}

function parseCashAmount(text) {
  const match = String(text ?? "").match(
    /(?:\$|USD\s*)(~?\d+(?:\.\d+)?\s*[MK]?)/i,
  );
  return match ? match[1].replace(/\s+/g, "") : null;
}

function parsePlayerIdentity(text) {
  const parts = String(text ?? "")
    .split(/\s+\/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    playerName: parts[0] ?? null,
    playerAliases: parts.slice(1),
  };
}

function deriveDraftYear(text, outcome) {
  const declaredDraftYear = parseDeclaredDraftYear(text);
  const possibleDraftYears = parseAllDraftYears(text);
  const conveyedYear = outcome?.conveyedYear ?? null;

  return {
    draftYear:
      conveyedYear ??
      declaredDraftYear ??
      (possibleDraftYears.length === 1 ? possibleDraftYears[0] : null),
    declaredDraftYear,
    possibleDraftYears,
    conveyedYear,
  };
}

function deriveRound(text) {
  const declaredRound = parseDeclaredRound(text);

  if (declaredRound) {
    return {
      round: declaredRound,
      declaredRound,
      possibleRounds: [declaredRound],
    };
  }

  const allRounds = parseAllRounds(text);
  const hasAlternativePath = /\belse\b|\botherwise\b/i.test(text);

  return {
    round:
      allRounds.length === 1
        ? allRounds[0]
        : hasAlternativePath
          ? null
          : (allRounds[0] ?? null),
    declaredRound: null,
    possibleRounds: allRounds,
  };
}

function isConditionalPick(text) {
  return /\bconditional\b|\bif\b|\belse\b|\botherwise\b|less favorable|more favorable|\boption\b/i.test(
    text,
  );
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
    const outcome = parseDraftOutcome(rawText);
    return {
      ...asset,
      type: "pick_swap",
      ...deriveDraftYear(rawText, outcome),
      ...deriveRound(rawText),
      protectionText: detectProtection(rawText),
      exerciseStatus: /not exercised/i.test(rawText)
        ? "not_exercised"
        : /\(\?-\?\)/.test(rawText)
          ? "unknown"
          : /exercised/i.test(rawText)
            ? "exercised"
            : "unknown",
      exercised: /not exercised/i.test(rawText)
        ? false
        : /exercised/i.test(rawText)
          ? true
          : null,
      status: "parsed-partial",
    };
  }

  if (
    /\btrade(?:d)?\s+player\s+exception\b/i.test(rawText) ||
    /\bTPE\b/.test(rawText)
  ) {
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

  const looksLikePick =
    /\b(?:draft\s+pick|round\s+pick|rounder|first[-\s]round|second[-\s]round|third[-\s]round|fourth[-\s]round|fifth[-\s]round|sixth[-\s]round|seventh[-\s]round|[1-7](?:st|nd|rd|th)[-\s]round)\b/i.test(
      rawText,
    );

  if (looksLikePick) {
    const outcome = parseDraftOutcome(rawText);
    return {
      ...asset,
      type: "draft_pick",
      ...deriveDraftYear(rawText, outcome),
      ...deriveRound(rawText),
      overall: parseOverall(rawText),
      becamePlayerName: outcome?.becamePlayerName ?? null,
      protectionText: detectProtection(rawText),
      conditional: isConditionalPick(rawText),
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
      /^[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+)+(?:\s+\([A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+)*\))?$/.test(
        identity.playerName,
      );

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
