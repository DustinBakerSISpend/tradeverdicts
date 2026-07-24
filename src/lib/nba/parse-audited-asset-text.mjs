import { parseNbaAssetText } from "./parse-asset-text.mjs";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikePlayerName(text) {
  return /^[A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÿ'’.-]+)+(?:\s+(?:Jr\.|Sr\.|II|III|IV))?$/u.test(text);
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

function parseDraftRights(text, context) {
  const match = String(text ?? "").match(
    /^(?:draft\s+rights(?:\s+to)?|rights\s+to)\s*:?\s*(.+?)(?:\s+\(#(\d{1,3})\))?$/iu,
  );
  if (!match) return null;

  const playerName = match[1].trim();
  if (!looksLikePlayerName(playerName)) return null;

  const overall = match[2] ? Number(match[2]) : null;
  const draftYear = Number.isInteger(context.draftYear)
    ? context.draftYear
    : null;

  return {
    type: "draft_rights",
    displayText: normalizeText(text),
    fromTeam: context.fromTeam ?? null,
    toTeam: context.toTeam ?? null,
    status: "parsed-audited",
    notes: [
      "Draft-rights player identity separated from audited pick-number context.",
    ],
    playerName,
    playerAliases: [],
    draftYear,
    overall,
  };
}

function parseContextualPlayer(text, context) {
  const match = String(text ?? "").match(/^(.+?)\s+\(([^)]*)\)$/u);
  if (!match) return null;

  const playerName = match[1].trim();
  const contextText = match[2].trim();
  if (!looksLikePlayerName(playerName) || /^#\d+$/u.test(contextText)) return null;

  const isContractContext =
    /sign-and-trade|contract|\byr\b|\$|extension|option/iu.test(contextText);

  return {
    type: "player",
    displayText: normalizeText(text),
    fromTeam: context.fromTeam ?? null,
    toTeam: context.toTeam ?? null,
    status: "parsed-audited",
    notes: [
      "Player identity separated from audited transaction context.",
    ],
    playerName,
    playerAliases: [],
    ...(isContractContext
      ? { contractContext: contextText }
      : { transactionContext: contextText }),
  };
}

function expandAbbreviatedPick(text) {
  return String(text ?? "")
    .replace(
      /\b(first|second|third|fourth|fifth|sixth|seventh)\s+\((?=[^)]+\))/giu,
      "$1 round pick (",
    )
    .replace(
      /\b(\d{4})\s+(first|second|third|fourth|fifth|sixth|seventh)\b(?!\s+round)/giu,
      "$1 $2 round pick",
    )
    .replace(
      /\b(first|second)\s+round\s+swap\s+rights\b/giu,
      "$1 round pick swap rights",
    );
}

function attachSwapContract(result, swapContract) {
  if (!swapContract) return result;

  const representationText = (swapContract.sourceRepresentations ?? [])
    .map((representation) => representation.displayText)
    .join(" ");
  const holderTeam = swapContract.holderTeam ?? null;
  const subjectTeam =
    swapContract.subjectTeam ??
    (/with\s+Wizards\b/iu.test(representationText)
      ? "washington-wizards"
      : null);
  const contractKey = [
    holderTeam ?? "unknown-holder",
    subjectTeam ?? "unknown-subject",
    swapContract.draftYear ?? result.draftYear ?? "unknown-year",
    swapContract.round ?? result.round ?? "unknown-round",
    swapContract.exerciseStatus ?? result.exerciseStatus ?? "unknown",
  ].join("|");

  return {
    ...result,
    contractKey,
    holderTeam,
    subjectTeam,
    draftYear: swapContract.draftYear ?? result.draftYear ?? null,
    round: swapContract.round ?? result.round ?? null,
    exerciseStatus:
      swapContract.exerciseStatus ?? result.exerciseStatus ?? "unknown",
    exercised:
      swapContract.exerciseStatus === "not_exercised"
        ? false
        : swapContract.exerciseStatus === "exercised"
          ? true
          : (result.exercised ?? null),
    sourceRepresentations: swapContract.sourceRepresentations ?? [],
    sourceRepresentationCount:
      swapContract.sourceRepresentationCount ??
      swapContract.sourceRepresentations?.length ??
      0,
    duplicateSourceRepresentation:
      swapContract.duplicateSourceRepresentation ?? false,
    contractDirectionResolved:
      Boolean(holderTeam && subjectTeam),
  };
}

export function parseAuditedNbaAssetText(value, context = {}) {
  const text = normalizeText(value);

  if (/\b(?:traded player|trade) exception\b|\bTPE\b/iu.test(text)) {
    return {
      type: "trade_exception",
      displayText: text,
      fromTeam: context.fromTeam ?? null,
      toTeam: context.toTeam ?? null,
      status: "parsed-audited",
      notes: ["Trade exception preserved as a non-player transaction asset."],
      auditSourceText: context.auditSourceText ?? text,
    };
  }

  if (/\bright of first refusal\b/iu.test(text)) {
    return {
      type: "conditional_asset",
      displayText: text,
      fromTeam: context.fromTeam ?? null,
      toTeam: context.toTeam ?? null,
      status: "parsed-audited",
      notes: [
        "Right-of-first-refusal consideration preserved as a non-player contractual asset.",
      ],
      auditSourceText: context.auditSourceText ?? text,
    };
  }

  const rights = parseDraftRights(text, context);
  if (rights) return rights;

  const contextualPlayer = parseContextualPlayer(text, context);
  if (contextualPlayer) return contextualPlayer;

  const expandedText = expandAbbreviatedPick(text);
  const parsed = parseNbaAssetText(expandedText, {
    ...context,
    legacyMode: true,
  });

  const enhancedOutcome = parseEnhancedDraftOutcome(text);
  let result = {
    ...parsed,
    displayText: text,
    status: parsed.status === "unclassified" ? parsed.status : "parsed-audited",
    auditSourceText: context.auditSourceText ?? text,
  };

  if (enhancedOutcome && ["draft_pick", "draft_rights"].includes(result.type)) {
    if (result.overall == null) result.overall = enhancedOutcome.overall;
    if (!result.becamePlayerName) {
      result.becamePlayerName = enhancedOutcome.becamePlayerName;
    }
  }

  if (result.type === "draft_pick" && result.overall == null) {
    const overall = text.match(/#(\d{1,3})\b/);
    if (overall) result.overall = Number(overall[1]);
  }

  if (result.type === "pick_swap") {
    result = attachSwapContract(result, context.swapContract ?? null);
  }

  if (
    result.type === "other" &&
    looksLikePlayerName(text.replace(/\s+\([^)]*\)$/u, ""))
  ) {
    const playerName = text.replace(/\s+\([^)]*\)$/u, "").trim();
    return {
      ...result,
      type: "player",
      status: "parsed-audited",
      playerName,
      playerAliases: [],
      notes: [
        ...(result.notes ?? []),
        "Player identity inferred from audited display text.",
      ],
    };
  }

  return result;
}

function roundNumber(roundWord) {
  return String(roundWord).toLowerCase() === "first" ? 1 : 2;
}

function findSwapContract(contracts, year, round) {
  return (contracts ?? []).find(
    (contract) =>
      Number(contract.draftYear) === Number(year) &&
      Number(contract.round) === Number(round),
  ) ?? null;
}

export function expandAuditedNbaAssetText(value, context = {}) {
  const text = normalizeText(value);
  const multiSwap = text.match(
    /^((?:\d{4}\s*,\s*)+\d{4})\s+(first|second)\s+round(?:\s+pick)?\s+swap rights(.*)$/iu,
  );

  if (multiSwap) {
    const years = [...multiSwap[1].matchAll(/\d{4}/g)].map((match) =>
      Number(match[0])
    );
    const round = roundNumber(multiSwap[2]);
    const suffix = multiSwap[3] ?? "";

    return years.map((year, index) => {
      const displayText =
        `${year} ${multiSwap[2].toLowerCase()} round pick swap rights${suffix}`;
      return {
        ...parseAuditedNbaAssetText(displayText, {
          ...context,
          auditSourceText: text,
          swapContract: findSwapContract(context.swapContracts, year, round),
        }),
        aggregateSourceText: text,
        aggregateSourceIndex: index,
        aggregateSourceCount: years.length,
      };
    });
  }

  const yearMatch = text.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/u);
  const roundMatch = text.match(/\b(first|second)\s+round\b/iu);
  const isSwap = /\bswap\s+rights\b|\bpick\s+swap\b|\boption\s+to\s+swap\b/iu.test(text);

  return [
    parseAuditedNbaAssetText(text, {
      ...context,
      swapContract:
        isSwap && yearMatch && roundMatch
          ? findSwapContract(
              context.swapContracts,
              Number(yearMatch[1]),
              roundNumber(roundMatch[1]),
            )
          : null,
    }),
  ];
}
