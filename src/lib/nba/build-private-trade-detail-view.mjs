const clean = (value = "") => String(value ?? "").trim();

const hasContent = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return clean(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

const firstContent = (...values) =>
  values.find((value) => hasContent(value)) ?? null;

const normalizedKey = (value) =>
  clean(value).toLowerCase().replace(/[^a-z0-9]+/gu, "");

const humanize = (value) =>
  clean(value)
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());

const textValue = (value) => {
  if (!hasContent(value)) return "";

  if (typeof value === "string") {
    return clean(value).replace(/\s+/gu, " ");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return clean(value);
  }

  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    return textValue(
      firstContent(
        value.analysis,
        value.summary,
        value.description,
        value.rationale,
        value.explanation,
        value.notes,
        value.verdict,
        value.context,
        value.outcome,
        value.label,
        value.name,
        value.asset,
      ),
    );
  }

  return "";
};

const teamKeys = (team) =>
  [team?.slug, team?.name, team?.abbreviation]
    .map(normalizedKey)
    .filter(Boolean);

const objectTeamKeys = (value) => {
  if (!value || typeof value !== "object") return [];

  return [
    value.teamSlug,
    value.team,
    value.slug,
    value.sourceTeam,
    value.normalizedTeam,
    value.franchise,
    value.abbreviation,
    value.teamName,
    value.name,
  ]
    .map(normalizedKey)
    .filter(Boolean);
};

const objectMatchesTeam = (value, team) => {
  const targets = new Set(teamKeys(team));
  return objectTeamKeys(value).some((key) => targets.has(key));
};

const scopedValue = (container, team, sourceIndex = -1) => {
  if (!hasContent(container)) return null;

  if (Array.isArray(container)) {
    const matches = container.filter((item) =>
      objectMatchesTeam(item, team),
    );

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return matches;

    if (sourceIndex >= 0 && sourceIndex < container.length) {
      return container[sourceIndex];
    }

    return null;
  }

  if (typeof container === "object") {
    const targets = new Set(teamKeys(team));
    const directKey = Object.keys(container).find((key) =>
      targets.has(normalizedKey(key)),
    );

    if (directKey) return container[directKey];
    if (objectMatchesTeam(container, team)) return container;
  }

  return null;
};

const perspectiveForTeam = (trade, team, sourceIndex) =>
  scopedValue(trade?.perspectives, team, sourceIndex);

const extractGrade = (value) => {
  if (!hasContent(value)) return "";

  if (typeof value === "string" || typeof value === "number") {
    const candidate = clean(value).toUpperCase();
    return /^(?:A[+-]?|B[+-]?|C[+-]?|D[+-]?|F)$/u.test(candidate) ? candidate : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const grade = extractGrade(item);
      if (grade) return grade;
    }
    return "";
  }

  if (typeof value === "object") {
    return extractGrade(
      firstContent(
        value.grade,
        value.teamGrade,
        value.letterGrade,
        value.finalGrade,
        value.value,
      ),
    );
  }

  return "";
};

const gradeForTeam = (trade, team, sourceIndex, perspective) =>
  extractGrade(
    firstContent(
      perspective?.grade,
      perspective?.teamGrade,
      scopedValue(trade?.grades, team, sourceIndex),
    ),
  );

const perspectiveEntries = (trade) => {
  const value = trade?.perspectives;

  if (Array.isArray(value)) {
    return value.filter(
      (entry) => entry && typeof entry === "object",
    );
  }

  if (!value || typeof value !== "object") return [];

  if (
    clean(value.sourceTeam) ||
    clean(value.sourceTradeId) ||
    clean(value.sourcePerspectiveKey)
  ) {
    return [value];
  }

  return Object.values(value).filter(
    (entry) => entry && typeof entry === "object",
  );
};

const partnerAggregateGradeForTrade = (trade) => {
  const candidates = [
    trade?.grades?.partnerAggregate,
    trade?.aggregatePartnerGrade,
    ...perspectiveEntries(trade).flatMap((perspective) => [
      perspective?.grades?.partnerAggregate,
      perspective?.aggregatePartnerGrade,
    ]),
  ];

  for (const candidate of candidates) {
    const grade = extractGrade(candidate);
    if (grade) return grade;
  }

  return "";
};

const gradeTone = (grade) => {
  const letter = clean(grade).charAt(0).toLowerCase();
  return ["a", "b", "c", "d", "f"].includes(letter)
    ? letter
    : "neutral";
};

const inferAssetType = (value, label) => {
  const explicit = clean(
    firstContent(
      value?.type,
      value?.assetType,
      value?.kind,
      value?.category,
      value?.referenceType,
    ),
  );

  if (explicit) return humanize(explicit);

  if (/\bpick\b|\bdraft\b|\bround\b|\boverall\b/iu.test(label)) {
    return "Pick";
  }

  if (/\bcash\b|\bconsideration\b/iu.test(label)) {
    return "Cash";
  }

  if (/\brights?\b/iu.test(label)) {
    return "Rights";
  }

  return "Asset";
};

const describePick = (value) => {
  if (!value || typeof value !== "object") return "";

  const year = clean(
    firstContent(value.year, value.draftYear, value.pickYear),
  );
  const round = clean(
    firstContent(value.round, value.draftRound, value.pickRound),
  );
  const overall = clean(
    firstContent(value.overall, value.overallPick, value.pickNumber),
  );
  const protection = clean(
    firstContent(
      value.protection,
      value.conditions,
      value.condition,
      value.qualifier,
    ),
  );

  if (!year && !round && !overall) return "";

  const parts = [];
  if (year) parts.push(year);
  if (round) parts.push(`${round}${/^\d$/u.test(round) ? "-round" : ""}`);
  parts.push("pick");
  if (overall) parts.push(`(${overall} overall)`);
  if (protection) parts.push(`(${protection})`);

  return parts.join(" ");
};

const describeAssetObject = (value) => {
  if (!value || typeof value !== "object") return "";

  const explicit = textValue(
    firstContent(
      value.displayText,
      value.asset,
      value.label,
      value.displayName,
      value.playerName,
      value.name,
      value.description,
      value.title,
      value.pickLabel,
      value.draftRightsTo,
      value.auditSourceText,
    ),
  );

  if (explicit) return explicit;

  const pick = describePick(value);
  if (pick) return pick;

  return "";
};

const flattenAssets = (value, depth = 0) => {
  if (!hasContent(value) || depth > 4) return [];

  if (typeof value === "string" || typeof value === "number") {
    const label = clean(value);
    return label
      ? [{ type: inferAssetType(null, label), label }]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenAssets(item, depth + 1));
  }

  if (typeof value === "object") {
    const label = describeAssetObject(value);

    if (label) {
      return [{
        type: inferAssetType(value, label),
        label,
      }];
    }

    const publicContainerKeys = new Set([
      "asset",
      "assets",
      "item",
      "items",
      "player",
      "players",
      "pick",
      "picks",
      "draftPick",
      "draftPicks",
      "right",
      "rights",
      "cash",
      "consideration",
      "considerations",
      "component",
      "components",
      "received",
      "incoming",
      "acquired",
      "gets",
    ]);

    return Object.entries(value)
      .filter(([key]) => publicContainerKeys.has(key))
      .flatMap(([key, child]) => {
        if (!hasContent(child)) return [];

        const nested = flattenAssets(child, depth + 1);

        if (
          nested.length === 1 &&
          ["string", "number", "boolean"].includes(typeof child)
        ) {
          return [{
            type: humanize(key),
            label: nested[0].label,
          }];
        }

        return nested;
      });
  }

  return [];
};

const dedupeAssets = (assets) => {
  const seen = new Set();
  const output = [];

  for (const asset of assets) {
    const label = clean(asset?.label);
    if (!label) continue;

    const signature = normalizedKey(label);
    if (!signature || seen.has(signature)) continue;

    seen.add(signature);
    output.push({
      type: clean(asset?.type) || "Asset",
      label,
    });
  }

  return output.slice(0, 24);
};

const assetsForTeam = (trade, team, sourceIndex, perspective) => {
  const direct = scopedValue(trade?.assetsReceived, team, sourceIndex);
  const perspectiveAssets = firstContent(
    perspective?.assetsReceived,
    perspective?.received,
    perspective?.assets,
    perspective?.acquired,
    perspective?.incoming,
    perspective?.gets,
  );
  const ledger = scopedValue(trade?.assetLedger, team, sourceIndex);

  return dedupeAssets(
    flattenAssets(firstContent(direct, perspectiveAssets, ledger)),
  );
};

const escapeRegex = (value) =>
  clean(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const splitAssetParts = (label, linkedPlayers) => {
  const text = clean(label);
  if (!text) return [];

  const candidates = linkedPlayers
    .filter((player) => clean(player?.name) && clean(player?.path))
    .sort((left, right) => right.name.length - left.name.length);

  const parts = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = candidates
      .map((player) => {
        const regex = new RegExp(
          `\\b${escapeRegex(player.name)}\\b`,
          "iu",
        );
        const found = remaining.match(regex);

        return found
          ? {
              player,
              index: found.index,
              length: found[0].length,
            }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.index - right.index)[0];

    if (!match) {
      parts.push({ type: "text", value: remaining });
      break;
    }

    if (match.index > 0) {
      parts.push({
        type: "text",
        value: remaining.slice(0, match.index),
      });
    }

    parts.push({
      type: "player",
      value: remaining.slice(
        match.index,
        match.index + match.length,
      ),
      path: match.player.path,
      name: match.player.name,
    });

    remaining = remaining.slice(match.index + match.length);
  }

  return parts;
};

const formatDate = (value) => {
  const raw = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;

  const [year, month, day] = raw.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const formatConfidence = (value) =>
  humanize(clean(value) || "Private record");

const internalEditorialSentencePatterns = [
  /\bprivate\s*\/\s*noindex\b/iu,
  /\bnoindex(?:ed|ing)?\b/iu,
  /\bindex(?:able|ing| eligibility)\b/iu,
  /\b(?:publication|publish status|publication readiness|authorized for publication)\b/iu,
  /\b(?:not|never)\s+authorized for publication\b/iu,
  /\b(?:public-facing|high[- ]value public page|low[- ]value public page)\b/iu,
  /\b(?:private|internal)\s+(?:record|page|row|review|preview|database|workflow)\b/iu,
  /\b(?:search|seo)\s+(?:value|visibility|demand)\b/iu,
  /\bstandalone (?:search )?(?:value|significance)\b/iu,
  /\b(?:limited|low|insufficient)\s+(?:standalone|public)\s+(?:value|significance)\b/iu,
  /\bhistorical footprint\b/iu,
  /\bminimum public treatment\b/iu,
  /\bteam-history aggregation\b/iu,
  /\buseful database record\b/iu,
  /\binsufficient initial standalone search value\b/iu,
  /\buntil enriched\b/iu,
  /\bthe (?:row|record|page) remains\b/iu,
  /\b(?:row|record|page)\s+(?:is|was|remains?)\s+(?:private|noindexed|held|kept)\b/iu,
  /\bdoes not support (?:a|an|the) .*?\bpublic page\b/iu,
  /\b(?:audit|review|import|routing|reconciliation|workflow|qa)\b.*\b(?:row|record|status|metadata|process)\b/iu,
  /\b(?:canonical|source) (?:row|record|data|evidence|grade|field|payload)\b/iu,
  /\bprivate archival import\b/iu,
  /\bpublic win-loss verdict\b/iu,
];

const sentenceSegmenter = new Intl.Segmenter("en", {
  granularity: "sentence",
});

const stripInternalEditorialClauses = (value) =>
  clean(value)
    .replace(
      /;\s*the (?:row|record|page) is complete for private archival import but not a public win-loss verdict\.?/giu,
      ".",
    )
    .replace(
      /\bthe (?:row|record|page) is complete for private archival import but not a public win-loss verdict\.?/giu,
      "",
    )
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\.{2,}/gu, ".")
    .trim();

const stripInternalEditorialLanguage = (value) => {
  const text = stripInternalEditorialClauses(value);
  if (!text) return "";

  return text
    .split(/\r?\n\s*\r?\n/gu)
    .map((paragraph) =>
      [...sentenceSegmenter.segment(paragraph)]
        .map((entry) => entry.segment.trim())
        .filter(Boolean)
        .filter(
          (sentence) =>
            !internalEditorialSentencePatterns.some((pattern) =>
              pattern.test(sentence),
            ),
        )
        .join(" "),
    )
    .filter(Boolean)
    .join("\n\n");
};

const possessiveTeamName = (name) =>
  /s$/iu.test(clean(name)) ? `${clean(name)}'` : `${clean(name)}'s`;

const narrativeRoleContextForTrade = (
  rawVerdict,
  displayVerdict,
  teamCards,
) => {
  const verdict = textValue(rawVerdict);
  const partnerFallback =
    teamCards.length === 2 ? "the other team" : "the other teams";
  const primaryFallback =
    teamCards.length === 2
      ? "the originating team"
      : "the originating side";

  if (!["Partner Win", "Slight Partner Edge"].includes(verdict)) {
    return {
      partnerName: "",
      primaryName: "",
      partnerFallback,
      primaryFallback,
    };
  }

  const partner = teamCards.find(
    (team) =>
      displayVerdict === `${team.name} Win` ||
      displayVerdict === `Slight ${team.name} Edge`,
  );

  if (!partner) {
    return {
      partnerName: "",
      primaryName: "",
      partnerFallback,
      primaryFallback,
    };
  }

  const primary =
    teamCards.length === 2
      ? teamCards.find((team) => team.name !== partner.name)
      : null;

  return {
    partnerName: partner.name,
    primaryName: primary?.name ?? "",
    partnerFallback,
    primaryFallback,
  };
};

const normalizeGenericRoleLanguage = (value, context = {}) => {
  let text = clean(value);
  if (!text) return "";

  const partnerName =
    clean(context.partnerName) ||
    clean(context.partnerFallback) ||
    "the other team";
  const primaryName =
    clean(context.primaryName) ||
    clean(context.primaryFallback) ||
    "the originating team";
  const partnerPossessive = possessiveTeamName(partnerName);
  const primaryPossessive = possessiveTeamName(primaryName);

  text = text
    .replace(/\bthe partner's\b/giu, partnerPossessive)
    .replace(/\bpartner's\b/giu, partnerPossessive)
    .replace(/\bthe partner side\b/giu, partnerName)
    .replace(/\bpartner side\b/giu, partnerName)
    .replace(/\bthe partner team\b/giu, partnerName)
    .replace(/\bpartner team\b/giu, partnerName)
    .replace(/\bthe partner\b/giu, partnerName)
    .replace(/\bpartner\b/giu, partnerName)
    .replace(/\bthe primary team's\b/giu, primaryPossessive)
    .replace(/\bprimary team's\b/giu, primaryPossessive)
    .replace(/\bthe primary team\b/giu, primaryName)
    .replace(/\bprimary team\b/giu, primaryName)
    .replace(/\bthe primary side\b/giu, primaryName)
    .replace(/\bprimary side\b/giu, primaryName)
    .replace(/\bthe primary's\b/giu, primaryPossessive)
    .replace(/\bprimary's\b/giu, primaryPossessive)
    .replace(/\bthe primary\b/giu, primaryName)
    .replace(/\bprimary\b/giu, primaryName);

  return text;
};

const publicNarrativeText = (value, context = {}) =>
  normalizeGenericRoleLanguage(
    stripInternalEditorialLanguage(textValue(value)),
    context,
  );

const splitAnalysis = (value) => {
  const text = clean(value);
  if (!text) return [];

  const headingPattern =
    /^(Why |What |How |The Long-Term Legacy$|The Contract Factor$|Final Verdict$|Why This Trade Still Matters$|Trade Context$|The Bottom Line$)/u;

  return text
    .split(/\r?\n\s*\r?\n/gu)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      type: headingPattern.test(block) ? "heading" : "paragraph",
      text: block,
    }));
};

const joinHumanList = (values) => {
  const items = [...new Set(values.map(clean).filter(Boolean))];

  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
};

const factualAssetRecap = (teamCards) => {
  const sentences = teamCards
    .map((team) => {
      const labels = (team.assets ?? [])
        .map((asset) => clean(asset?.label))
        .filter(Boolean);
      const assetList = joinHumanList(labels);

      return assetList
        ? `${team.name} received ${assetList}.`
        : "";
    })
    .filter(Boolean);

  if (sentences.length > 0) return sentences.join(" ");

  const teamNames = joinHumanList(
    teamCards.map((team) => team.name),
  );

  return teamNames
    ? `The transaction involved ${teamNames}.`
    : "";
};

const overallAnalysis = (trade) => {
  if (typeof trade?.analysis === "string") {
    return clean(trade.analysis);
  }

  if (trade?.analysis && typeof trade.analysis === "object") {
    return textValue(
      firstContent(
        trade.analysis.overall,
        trade.analysis.shared,
        trade.analysis.summary,
        trade.analysis.narrative,
        trade.analysis.context,
        trade.analysis.verdict,
      ),
    );
  }

  return "";
};

const perspectiveAnalysis = (perspective) =>
  textValue(
    firstContent(
      perspective?.analysis,
      perspective?.tradeAnalysis,
      perspective?.verdictAnalysis,
      perspective?.editorialAnalysis,
      perspective?.analysisText,
      perspective?.verdictRationale,
      perspective?.rationale,
      perspective?.longAnalysis,
      perspective?.assessment,
      perspective?.tradeAssessment,
    ),
  );

const analysisSectionsForTrade = (
  trade,
  teamCards,
  narrativeContext,
) => {
  const overall = publicNarrativeText(
    overallAnalysis(trade),
    narrativeContext,
  );

  if (overall) {
    return {
      source: "canonical-overall",
      sections: [{
        heading: "",
        blocks: splitAnalysis(overall),
      }],
    };
  }

  const seen = new Set();
  const sections = [];

  for (const team of teamCards) {
    const analysis = publicNarrativeText(
      team.perspectiveAnalysis,
      narrativeContext,
    );
    const signature = normalizedKey(analysis);

    if (!analysis || !signature || seen.has(signature)) continue;

    seen.add(signature);
    sections.push({
      heading: `${team.name} Perspective`,
      blocks: splitAnalysis(analysis),
    });
  }

  if (sections.length > 0) {
    return {
      source: "canonical-perspectives",
      sections,
    };
  }

  const summary = publicNarrativeText(
    trade?.summary,
    narrativeContext,
  );
  const fallback = summary || factualAssetRecap(teamCards);

  return {
    source: summary
      ? "canonical-summary-fallback"
      : fallback
        ? "factual-asset-recap-fallback"
        : "missing",
    sections: fallback
      ? [{ heading: "", blocks: splitAnalysis(fallback) }]
      : [],
  };
};

const gradeRank = (grade) => {
  const ranks = new Map([
    ["F", 0],
    ["D-", 1],
    ["D", 2],
    ["D+", 3],
    ["C-", 4],
    ["C", 5],
    ["C+", 6],
    ["B-", 7],
    ["B", 8],
    ["B+", 9],
    ["A-", 10],
    ["A", 11],
    ["A+", 12],
  ]);

  return ranks.get(clean(grade).toUpperCase()) ?? null;
};

const displayVerdictForTrade = (rawVerdict, teamCards) => {
  const verdict = textValue(rawVerdict);
  if (!["Partner Win", "Slight Partner Edge"].includes(verdict)) {
    return verdict;
  }

  const rankedTeams = teamCards.map((team) => ({
    ...team,
    rank: gradeRank(team.grade),
  }));
  const graded = rankedTeams.filter((team) => team.rank !== null);
  const ungraded = rankedTeams.filter((team) => team.rank === null);

  if (graded.length === 1 && ungraded.length === 1) {
    return verdict === "Partner Win"
      ? `${ungraded[0].name} Win`
      : `Slight ${ungraded[0].name} Edge`;
  }

  if (graded.length === 0) return verdict;

  const topRank = Math.max(...graded.map((team) => team.rank));
  const leaders = graded.filter((team) => team.rank === topRank);

  if (leaders.length !== 1) return "Even Trade";

  return verdict === "Partner Win"
    ? `${leaders[0].name} Win`
    : `Slight ${leaders[0].name} Edge`;
};

export function buildPrivateTradeDetailView({ trade, model }) {
  if (!trade || model?.routeType !== "trade_detail") {
    return {
      available: false,
      teamCards: [],
      gradePanels: [],
      gradeCoverageNote: "",
      partnerAggregateGrade: "",
      linkedPlayers: [],
      unmatchedPlayers: [],
      renderedPlayerPaths: [],
      analysisSource: "missing",
      analysisSections: [],
      analysisBlocks: [],
    };
  }

  const sourceTeamOrder = Array.isArray(trade.teams)
    ? trade.teams.map(clean)
    : [];
  const linkedPlayers = (
    Array.isArray(model.players) ? model.players : []
  ).map((player) => ({
    name: clean(player.name),
    path: clean(player.path),
  }));

  const matchedPlayerPaths = new Set();

  const teamCards = (Array.isArray(model.teams) ? model.teams : []).map(
    (team) => {
      const sourceIndex = sourceTeamOrder.indexOf(team.slug);
      const perspective = perspectiveForTeam(
        trade,
        team,
        sourceIndex,
      );
      const grade = gradeForTeam(
        trade,
        team,
        sourceIndex,
        perspective,
      );
      const assets = assetsForTeam(
        trade,
        team,
        sourceIndex,
        perspective,
      ).map((asset) => {
        const parts = splitAssetParts(asset.label, linkedPlayers);

        for (const part of parts) {
          if (part.type === "player" && part.path) {
            matchedPlayerPaths.add(part.path);
          }
        }

        return {
          ...asset,
          parts,
        };
      });

      return {
        ...team,
        grade,
        gradeTone: gradeTone(grade),
        assets,
        perspectiveAnalysis: perspectiveAnalysis(perspective),
      };
    },
  );

  const explicitGradePanels = teamCards
    .filter((team) => Boolean(team.grade))
    .map((team) => ({
      type: "team",
      name: team.name,
      path: team.path,
      subtitle: "",
      grade: team.grade,
      gradeTone: team.gradeTone,
    }));
  const ungradedTeamCards = teamCards.filter(
    (team) => !team.grade,
  );
  const partnerAggregateGrade =
    partnerAggregateGradeForTrade(trade);
  const canUsePartnerAggregate =
    explicitGradePanels.length === 1 &&
    ungradedTeamCards.length > 0 &&
    Boolean(partnerAggregateGrade);
  const aggregateGradePanel = canUsePartnerAggregate
    ? {
        type: "aggregate",
        name:
          ungradedTeamCards.length === 1
            ? ungradedTeamCards[0].name
            : "Partner side",
        path:
          ungradedTeamCards.length === 1
            ? ungradedTeamCards[0].path
            : "",
        subtitle:
          ungradedTeamCards.length > 1
            ? ungradedTeamCards
                .map((team) => team.name)
                .join(" / ")
            : "Aggregate partner grade",
        grade: partnerAggregateGrade,
        gradeTone: gradeTone(partnerAggregateGrade),
      }
    : null;
  const gradePanels = aggregateGradePanel
    ? [...explicitGradePanels, aggregateGradePanel]
    : explicitGradePanels;
  const unresolvedGradeTeams = aggregateGradePanel
    ? []
    : ungradedTeamCards.map((team) => team.name);
  const gradeCoverageNote =
    unresolvedGradeTeams.length > 0
      ? `No separate canonical grade is recorded for ${
          unresolvedGradeTeams.join(", ")
        }.`
      : "";
  const unmatchedPlayers = linkedPlayers.filter(
    (player) => !matchedPlayerPaths.has(player.path),
  );
  const rawVerdict = textValue(firstContent(trade.verdict, model.verdict));
  const displayVerdict = displayVerdictForTrade(rawVerdict, teamCards);
  const narrativeContext = narrativeRoleContextForTrade(
    rawVerdict,
    displayVerdict,
    teamCards,
  );
  const analysisResult = analysisSectionsForTrade(
    trade,
    teamCards,
    narrativeContext,
  );
  const summary = [
    trade.summary,
    model.description,
  ]
    .map((value) => publicNarrativeText(value, narrativeContext))
    .find(Boolean) ?? "";

  return {
    available: true,
    title: clean(model.title),
    heroTitle: displayVerdict,
    summary,
    sourceTradeId: clean(
      firstContent(trade.sourceTradeId, model.sourceTradeId),
    ),
    tradeDate: clean(firstContent(trade.tradeDate, model.tradeDate)),
    formattedTradeDate: formatDate(
      firstContent(trade.tradeDate, model.tradeDate),
    ),
    seasonLabel: clean(firstContent(trade.seasonLabel, trade.season)),
    confidence: formatConfidence(trade.confidence),
    publishStatus: clean(trade.publishStatus),
    teamLabel: teamCards.map((team) => team.name).join(" / "),
    verdict: displayVerdict,
    rawVerdict,
    verdictWasNormalized: displayVerdict !== rawVerdict,
    analysis: analysisResult.sections
      .flatMap((section) => section.blocks)
      .map((block) => block.text)
      .join("\n\n"),
    analysisSource: analysisResult.source,
    analysisSections: analysisResult.sections,
    analysisBlocks: analysisResult.sections.flatMap(
      (section) => section.blocks,
    ),
    teamCards,
    gradePanels,
    gradeCoverageNote,
    partnerAggregateGrade:
      aggregateGradePanel?.grade ?? "",
    linkedPlayers,
    unmatchedPlayers,
    renderedPlayerPaths: [
      ...new Set([
        ...matchedPlayerPaths,
        ...unmatchedPlayers.map((player) => player.path),
      ]),
    ].sort(),
    hasGrades: gradePanels.length > 0,
    hasAssets: teamCards.some((team) => team.assets.length > 0),
    hasPlayers: linkedPlayers.length > 0,
  };
}
