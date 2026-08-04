const GRADE_POINTS = Object.freeze({
  "A+": 12,
  A: 11,
  "A-": 10,
  "B+": 9,
  B: 8,
  "B-": 7,
  "C+": 6,
  C: 5,
  "C-": 4,
  "D+": 3,
  D: 2,
  "D-": 1,
  F: 0,
});

const PRESENTATION_LINEAGE_OVERRIDES = Object.freeze({
  grizzlies: "memphis-grizzlies",
});

const SOURCE_PREFIX_TO_CURRENT_SLUG = Object.freeze({
  ATL: "atlanta-hawks",
  BAL: "washington-wizards",
  BOS: "boston-celtics",
  BKN: "brooklyn-nets",
  NJN: "brooklyn-nets",
  CHA: "charlotte-hornets",
  CHI: "chicago-bulls",
  CLE: "cleveland-cavaliers",
  DAL: "dallas-mavericks",
  DEN: "denver-nuggets",
  DET: "detroit-pistons",
  GSW: "golden-state-warriors",
  HOU: "houston-rockets",
  IND: "indiana-pacers",
  LAC: "los-angeles-clippers",
  LAL: "los-angeles-lakers",
  MEM: "memphis-grizzlies",
  MIA: "miami-heat",
  MIL: "milwaukee-bucks",
  MIN: "minnesota-timberwolves",
  MINNBA: "minnesota-timberwolves",
  NOP: "new-orleans-pelicans",
  NOPNBA: "new-orleans-pelicans",
  NOH: "new-orleans-pelicans",
  NOK: "new-orleans-pelicans",
  NYK: "new-york-knicks",
  NYKNBA: "new-york-knicks",
  OKC: "oklahoma-city-thunder",
  OKCNBA: "oklahoma-city-thunder",
  SEA: "oklahoma-city-thunder",
  SEANBA: "oklahoma-city-thunder",
  ORL: "orlando-magic",
  PHI: "philadelphia-76ers",
  PHX: "phoenix-suns",
  POR: "portland-trail-blazers",
  SAC: "sacramento-kings",
  SAS: "san-antonio-spurs",
  TOR: "toronto-raptors",
  UTA: "utah-jazz",
  WAS: "washington-wizards",
});

const EXTRA_ALIASES_BY_CURRENT = Object.freeze({
  "atlanta-hawks": [
    "hawks",
    "atlanta",
    "tri cities blackhawks",
    "milwaukee hawks",
    "st louis hawks",
  ],
  "brooklyn-nets": [
    "nets",
    "brooklyn",
    "new jersey nets",
  ],
  "charlotte-hornets": [
    "charlotte",
    "hornets",
    "bobcats",
    "charlotte bobcats",
  ],
  "golden-state-warriors": [
    "warriors",
    "golden state",
    "philadelphia warriors",
    "san francisco warriors",
  ],
  "los-angeles-clippers": [
    "clippers",
    "la clippers",
    "buffalo braves",
    "san diego clippers",
  ],
  "los-angeles-lakers": [
    "lakers",
    "minneapolis lakers",
  ],
  "minnesota-timberwolves": [
    "wolves",
    "timberwolves",
    "minnesota",
  ],
  "memphis-grizzlies": [
    "grizzlies",
    "vancouver grizzlies",
  ],
  "new-orleans-pelicans": [
    "pelicans",
    "new orleans",
    "new orleans hornets",
    "new orleans oklahoma city hornets",
  ],
  "oklahoma-city-thunder": [
    "thunder",
    "oklahoma city",
    "seattle supersonics",
    "supersonics",
    "sonics",
  ],
  "philadelphia-76ers": [
    "76ers",
    "sixers",
    "philadelphia",
    "syracuse nationals",
  ],
  "sacramento-kings": [
    "kings",
    "sacramento",
    "rochester royals",
    "cincinnati royals",
    "kansas city omaha kings",
    "kansas city kings",
  ],
  "san-antonio-spurs": [
    "spurs",
    "san antonio",
    "dallas chaparrals",
    "texas chaparrals",
  ],
  "utah-jazz": [
    "jazz",
    "utah",
    "new orleans jazz",
  ],
  "washington-wizards": [
    "wizards",
    "washington",
    "chicago packers",
    "chicago zephyrs",
    "baltimore bullets",
    "capital bullets",
    "washington bullets",
  ],
});

const OWNER_FIELDS = Object.freeze([
  "team",
  "teamSlug",
  "teamName",
  "primaryTeam",
  "primaryTeamSlug",
  "sourceTeam",
  "sourceTeamSlug",
  "franchise",
  "franchiseSlug",
  "ownerTeam",
  "ownerTeamSlug",
  "perspectiveTeam",
  "perspectiveTeamSlug",
]);

const clean = (value = "") => String(value ?? "").trim();
const unique = (values) => [...new Set(values.filter(Boolean))];

const normalize = (value = "") =>
  clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const normalizeCode = (value = "") =>
  clean(value).toUpperCase().replace(/[^A-Z0-9]+/gu, "");

export function nbaGradeValue(value) {
  const grade = clean(value);

  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade)
    ? GRADE_POINTS[grade]
    : null;
}

export function createNbaFranchiseLineage(teams) {
  if (!Array.isArray(teams)) {
    throw new TypeError("createNbaFranchiseLineage requires a team array.");
  }

  const teamBySlug = new Map();
  const activeTeams = [];

  for (const team of teams) {
    if (!team || typeof team !== "object") {
      throw new TypeError("Every NBA team entry must be an object.");
    }

    const slug = clean(team.slug);
    const name = clean(team.name);

    if (!slug || !name) {
      throw new Error("Every NBA team entry requires a slug and name.");
    }

    if (teamBySlug.has(slug)) {
      throw new Error(`Duplicate NBA team slug: ${slug}`);
    }

    const normalized = {
      ...team,
      slug,
      name,
      abbreviation: clean(team.abbreviation),
    };

    teamBySlug.set(slug, normalized);

    if (team.active === true) {
      activeTeams.push(normalized);
    }
  }

  const activeTeamBySlug = new Map(
    activeTeams.map((team) => [team.slug, team]),
  );
  const activeSlugSet = new Set(activeTeamBySlug.keys());
  const currentSlugBySource = new Map();
  const sourceSlugsByCurrent = new Map(
    activeTeams.map((team) => [team.slug, [team.slug]]),
  );

  for (const team of teams) {
    const slug = clean(team.slug);

    if (activeSlugSet.has(slug)) {
      currentSlugBySource.set(slug, slug);
      continue;
    }

    const overrideTarget = clean(PRESENTATION_LINEAGE_OVERRIDES[slug]);
    const registryTarget = clean(team.lineageTeam);
    const currentSlug =
      (activeSlugSet.has(overrideTarget) && overrideTarget) ||
      (activeSlugSet.has(registryTarget) && registryTarget) ||
      "";

    if (!currentSlug) {
      continue;
    }

    currentSlugBySource.set(slug, currentSlug);
    sourceSlugsByCurrent.get(currentSlug).push(slug);
  }

  for (const [currentSlug, sourceSlugs] of sourceSlugsByCurrent) {
    sourceSlugsByCurrent.set(
      currentSlug,
      unique(sourceSlugs).sort((left, right) =>
        left.localeCompare(right, "en"),
      ),
    );
  }

  return {
    teamBySlug,
    activeTeamBySlug,
    activeTeams: activeTeams
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, "en")),
    currentSlugBySource,
    sourceSlugsByCurrent,
    getCurrentSlug(sourceSlug) {
      return currentSlugBySource.get(clean(sourceSlug)) ?? null;
    },
    getSourceSlugs(currentSlug) {
      return [
        ...(sourceSlugsByCurrent.get(clean(currentSlug)) ?? []),
      ];
    },
  };
}

function createOutcomeContext({ teams, lineage }) {
  const teamBySlug = lineage.teamBySlug;
  const aliasesBySourceSlug = new Map();

  const currentSlugForSource = (sourceSlug) =>
    lineage.getCurrentSlug(sourceSlug) ??
    (lineage.activeTeamBySlug.has(sourceSlug) ? sourceSlug : null);

  const currentSourceSet = (sourceSlug) => {
    const currentSlug = currentSlugForSource(sourceSlug);

    if (!currentSlug) return new Set([sourceSlug]);

    return new Set(lineage.getSourceSlugs(currentSlug));
  };

  for (const team of teams) {
    const sourceSlug = clean(team.slug);
    const currentSlug = currentSlugForSource(sourceSlug);
    const currentTeam = currentSlug
      ? lineage.activeTeamBySlug.get(currentSlug)
      : null;
    const aliases = [
      sourceSlug,
      team.name,
      team.abbreviation,
      currentSlug,
      currentTeam?.name,
      currentTeam?.abbreviation,
      ...(currentSlug
        ? EXTRA_ALIASES_BY_CURRENT[currentSlug] ?? []
        : []),
    ]
      .map(normalize)
      .filter(Boolean);

    for (const name of [team.name, currentTeam?.name]) {
      const words = normalize(name).split(" ").filter(Boolean);

      if (words.length > 0) aliases.push(words.at(-1));
      if (words.length > 1) aliases.push(words.slice(-2).join(" "));
    }

    aliasesBySourceSlug.set(sourceSlug, new Set(aliases));
  }

  const resolveParticipantSlug = (value, tradeTeams) => {
    const needle = normalize(value);

    if (!needle) return null;

    const exactSlug = tradeTeams.find(
      (slug) => normalize(slug) === needle,
    );

    if (exactSlug) return exactSlug;

    const matches = tradeTeams.filter((slug) =>
      aliasesBySourceSlug.get(slug)?.has(needle),
    );

    return matches.length === 1 ? matches[0] : null;
  };

  const sourceIdPrefix = (trade) =>
    normalizeCode(clean(trade?.sourceTradeId).split("-")[0]);

  const inferOwnerFromSourceId = (trade, tradeTeams) => {
    const prefix = sourceIdPrefix(trade);
    const strippedPrefix = prefix.endsWith("NBA")
      ? prefix.slice(0, -3)
      : prefix;
    const mappedCurrentSlug =
      SOURCE_PREFIX_TO_CURRENT_SLUG[prefix] ??
      SOURCE_PREFIX_TO_CURRENT_SLUG[strippedPrefix] ??
      null;

    if (mappedCurrentSlug) {
      const sourceSet = new Set(
        lineage.getSourceSlugs(mappedCurrentSlug),
      );
      const mappedMatches = tradeTeams.filter((slug) =>
        sourceSet.has(slug),
      );

      if (mappedMatches.length === 1) {
        return {
          ownerSlug: mappedMatches[0],
          method: "manual-prefix-current-lineage",
          prefix,
        };
      }
    }

    const abbreviationMatches = tradeTeams.filter((slug) => {
      const team = teamBySlug.get(slug);
      const abbreviation = normalizeCode(team?.abbreviation);

      return (
        abbreviation === prefix ||
        abbreviation === strippedPrefix
      );
    });

    if (abbreviationMatches.length === 1) {
      return {
        ownerSlug: abbreviationMatches[0],
        method: "participant-abbreviation",
        prefix,
      };
    }

    const acronymMatches = tradeTeams.filter((slug) => {
      const team = teamBySlug.get(slug);
      const acronym = normalizeCode(
        normalize(team?.name)
          .split(" ")
          .filter(Boolean)
          .map((word) => word[0])
          .join(""),
      );

      return acronym === prefix || acronym === strippedPrefix;
    });

    if (acronymMatches.length === 1) {
      return {
        ownerSlug: acronymMatches[0],
        method: "participant-name-acronym",
        prefix,
      };
    }

    return {
      ownerSlug: null,
      method:
        abbreviationMatches.length > 1 ||
        acronymMatches.length > 1
          ? "ambiguous"
          : "unresolved",
      prefix,
    };
  };

  const resolveRecordOwner = (record, tradeTeams) => {
    if (!record || typeof record !== "object") return null;

    for (const field of OWNER_FIELDS) {
      const owner = resolveParticipantSlug(
        record[field],
        tradeTeams,
      );

      if (owner) return owner;
    }

    return null;
  };

  const parseSignal = (value, tradeTeams) => {
    const text = clean(value);

    if (!text) {
      return {
        type: "none",
        sourceSlug: null,
        text,
      };
    }

    if (/^(?:even|even trade)$/iu.test(text)) {
      return {
        type: "even",
        sourceSlug: null,
        text,
      };
    }

    if (/^(?:insufficient|incomplete) evidence$/iu.test(text)) {
      return {
        type: "unknown",
        sourceSlug: null,
        text,
      };
    }

    if (/^(?:partner win|slight partner edge)$/iu.test(text)) {
      return {
        type: "partner",
        sourceSlug: null,
        text,
      };
    }

    if (/^(?:primary win|slight primary edge)$/iu.test(text)) {
      return {
        type: "primary",
        sourceSlug: null,
        text,
      };
    }

    const stripped = text
      .replace(/^slight\s+/iu, "")
      .replace(/\s+(?:edge|win)$/iu, "");
    const sourceSlug = resolveParticipantSlug(
      stripped,
      tradeTeams,
    );

    if (sourceSlug) {
      return {
        type: "named-team",
        sourceSlug,
        text,
      };
    }

    return {
      type: "unresolved",
      sourceSlug: null,
      text,
    };
  };

  const outcomeFromSignal = ({
    signal,
    ownerSlug,
    targetSourceSlug,
    tradeTeams,
  }) => {
    const targetSet = currentSourceSet(targetSourceSlug);

    if (signal.type === "even") {
      return {
        outcome: "even",
        resolution: "global-even",
      };
    }

    if (signal.type === "unknown") {
      return {
        outcome: "unknown",
        resolution: "global-unknown",
      };
    }

    if (signal.type === "named-team") {
      return {
        outcome: targetSet.has(signal.sourceSlug)
          ? "win"
          : "loss",
        resolution: "named-participant",
      };
    }

    if (signal.type === "primary") {
      if (!ownerSlug) return null;

      return {
        outcome: targetSet.has(ownerSlug)
          ? "win"
          : "loss",
        resolution: "primary-relative-to-owner",
      };
    }

    if (signal.type === "partner") {
      if (!ownerSlug) return null;

      if (targetSet.has(ownerSlug)) {
        return {
          outcome: "loss",
          resolution: "partner-verdict-owner-loss",
        };
      }

      if (tradeTeams.length === 2) {
        return {
          outcome: "win",
          resolution: "partner-verdict-two-team-partner-win",
        };
      }

      return null;
    }

    return null;
  };

  const parseRecordOutcome = ({
    record,
    ownerSlug,
    targetSourceSlug,
    tradeTeams,
  }) => {
    if (!record || typeof record !== "object") return null;

    for (const field of ["verdict", "winner"]) {
      const signal = parseSignal(record[field], tradeTeams);
      const resolved = outcomeFromSignal({
        signal,
        ownerSlug,
        targetSourceSlug,
        tradeTeams,
      });

      if (resolved) {
        return {
          ...resolved,
          signalType: field,
          signalValue: signal.text,
          signalClass: signal.type,
          signalSourceSlug: signal.sourceSlug,
          ownerSlug,
        };
      }
    }

    const score = Number(record.outcomeScore);
    const targetSet = currentSourceSet(targetSourceSlug);

    if (
      Number.isFinite(score) &&
      ownerSlug &&
      targetSet.has(ownerSlug)
    ) {
      return {
        outcome:
          score > 0
            ? "win"
            : score < 0
              ? "loss"
              : "even",
        resolution: "owned-outcome-score",
        signalType: "outcomeScore",
        signalValue: String(score),
        signalClass: "score",
        signalSourceSlug: null,
        ownerSlug,
      };
    }

    return null;
  };

  const gradeOutcome = ({
    trade,
    targetSourceSlug,
    sourceSlugSet,
    tradeTeams,
  }) => {
    const targetGrade = nbaGradeValue(
      trade?.grades?.[targetSourceSlug],
    );

    if (targetGrade === null) return "unknown";

    const opponentGrades = tradeTeams
      .filter((slug) => !sourceSlugSet.has(slug))
      .map((slug) => nbaGradeValue(trade?.grades?.[slug]))
      .filter((value) => value !== null);

    if (opponentGrades.length === 0) return "unknown";

    const strongestOpponent = Math.max(...opponentGrades);

    if (targetGrade > strongestOpponent) return "win";
    if (targetGrade < strongestOpponent) return "loss";
    return "even";
  };

  return {
    currentSlugForSource,
    currentSourceSet,
    resolveRecordOwner,
    inferOwnerFromSourceId,
    parseRecordOutcome,
    gradeOutcome,
  };
}

function resolveTradeOutcome({
  trade,
  targetSourceSlug,
  sourceSlugSet,
  context,
}) {
  const tradeTeams = Array.isArray(trade?.teams)
    ? trade.teams.map(clean).filter(Boolean)
    : [];
  const gradeOutcome = context.gradeOutcome({
    trade,
    targetSourceSlug,
    sourceSlugSet,
    tradeTeams,
  });
  const sourceOwnerInference = context.inferOwnerFromSourceId(
    trade,
    tradeTeams,
  );
  const explicitTradeOwner =
    context.resolveRecordOwner(trade, tradeTeams) ??
    sourceOwnerInference.ownerSlug;
  const parsedTrade = context.parseRecordOutcome({
    record: trade,
    ownerSlug: explicitTradeOwner,
    targetSourceSlug,
    tradeTeams,
  });

  if (tradeTeams.length === 2) {
    if (parsedTrade) {
      return {
        outcome: parsedTrade.outcome,
        method: "two-team-canonical-trade",
        explicit: true,
        sourceOwnerInference,
      };
    }

    return {
      outcome: gradeOutcome,
      method: "two-team-grade-fallback",
      explicit: false,
      sourceOwnerInference,
    };
  }

  const perspectives = Array.isArray(trade?.perspectives)
    ? trade.perspectives
    : [];
  const perspectiveCandidates = [];

  for (let index = 0; index < perspectives.length; index += 1) {
    const perspective = perspectives[index];
    const ownerSlug = context.resolveRecordOwner(
      perspective,
      tradeTeams,
    );

    if (!ownerSlug) continue;

    const ownerSet = context.currentSourceSet(ownerSlug);

    if (!ownerSet.has(targetSourceSlug)) continue;

    const parsed = context.parseRecordOutcome({
      record: perspective,
      ownerSlug,
      targetSourceSlug,
      tradeTeams,
    });

    if (parsed) {
      perspectiveCandidates.push({
        ...parsed,
        provenance: `perspective[${index}]`,
      });
    }
  }

  const uniquePerspectiveOutcomes = unique(
    perspectiveCandidates.map((candidate) => candidate.outcome),
  );

  if (uniquePerspectiveOutcomes.length === 1) {
    return {
      outcome: perspectiveCandidates[0].outcome,
      method: "multi-team-owned-perspective",
      explicit: true,
      sourceOwnerInference,
    };
  }

  if (uniquePerspectiveOutcomes.length > 1) {
    return {
      outcome: gradeOutcome,
      method: "multi-team-conflicting-perspective-grade-fallback",
      explicit: false,
      sourceOwnerInference,
    };
  }

  if (parsedTrade) {
    return {
      outcome: parsedTrade.outcome,
      method: "multi-team-trade",
      explicit: true,
      sourceOwnerInference,
    };
  }

  return {
    outcome: gradeOutcome,
    method: "multi-team-grade-fallback",
    explicit: false,
    sourceOwnerInference,
  };
}

function buildArchiveResult({
  trades,
  lineage,
  currentTeam,
  context,
}) {
  const sourceSlugs = lineage.getSourceSlugs(currentTeam.slug);
  const sourceSlugSet = new Set(sourceSlugs);
  const archiveTrades = trades
    .filter((trade) =>
      (Array.isArray(trade?.teams) ? trade.teams : []).some((slug) =>
        sourceSlugSet.has(clean(slug)),
      ),
    )
    .slice()
    .sort((left, right) =>
      clean(left.tradeDate || left.date).localeCompare(
        clean(right.tradeDate || right.date),
      ) ||
      clean(left.sourceTradeId).localeCompare(clean(right.sourceTradeId)),
    );

  const duplicateTradeIds = archiveTrades
    .map((trade) => clean(trade.id))
    .filter(
      (id, index, values) =>
        id && values.indexOf(id) !== index,
    );

  if (duplicateTradeIds.length > 0) {
    throw new Error(
      `${currentTeam.slug}: duplicate archive trade IDs: ${unique(duplicateTradeIds).join(", ")}`,
    );
  }

  let wins = 0;
  let losses = 0;
  let even = 0;
  let unknown = 0;
  const membershipRows = [];

  for (const trade of archiveTrades) {
    const tradeTeams = (Array.isArray(trade?.teams)
      ? trade.teams
      : []
    )
      .map(clean)
      .filter(Boolean);
    const matchingSourceSlugs = tradeTeams.filter((slug) =>
      sourceSlugSet.has(slug),
    );

    if (matchingSourceSlugs.length !== 1) {
      throw new Error(
        `${currentTeam.slug}: ${clean(trade.sourceTradeId)} maps ${matchingSourceSlugs.length} source teams into one current franchise.`,
      );
    }

    const targetSourceSlug = matchingSourceSlugs[0];
    const result = resolveTradeOutcome({
      trade,
      targetSourceSlug,
      sourceSlugSet,
      context,
    });

    if (result.outcome === "win") wins += 1;
    else if (result.outcome === "loss") losses += 1;
    else if (result.outcome === "even") even += 1;
    else unknown += 1;

    membershipRows.push({
      currentSlug: currentTeam.slug,
      sourceSlug: targetSourceSlug,
      canonicalTradeId: clean(trade.id),
      sourceTradeId: clean(trade.sourceTradeId),
      teamCount: tradeTeams.length,
      outcome: result.outcome,
      method: result.method,
      explicit: result.explicit,
      ownerResolved: Boolean(result.sourceOwnerInference.ownerSlug),
      ownerMethod: result.sourceOwnerInference.method,
    });
  }

  const years = archiveTrades
    .map((trade) =>
      Number(clean(trade.tradeDate || trade.date).slice(0, 4)),
    )
    .filter((year) => Number.isInteger(year) && year > 0);

  return {
    archive: {
      name: currentTeam.name,
      slug: currentTeam.slug,
      abbreviation: currentTeam.abbreviation,
      path: `/nba/teams/${currentTeam.slug}/`,
      sourceSlugs,
      total: archiveTrades.length,
      wins,
      losses,
      even,
      unknown,
      firstYear: years.length > 0 ? Math.min(...years) : null,
      lastYear: years.length > 0 ? Math.max(...years) : null,
      yearRange:
        years.length > 0
          ? `${Math.min(...years)}-${Math.max(...years)}`
          : "Coming soon",
      tradeLinks: archiveTrades.map((trade) => ({
        path: `/nba/trades/${clean(trade.slug)}/`,
        relation: "trade_detail",
        entityId: clean(trade.id) || null,
      })),
    },
    membershipRows,
  };
}

function buildDirectoryResult({ trades, teams }) {
  if (!Array.isArray(trades) || !Array.isArray(teams)) {
    throw new TypeError("buildNbaTeamDirectory requires trade and team arrays.");
  }

  const lineage = createNbaFranchiseLineage(teams);
  const context = createOutcomeContext({ teams, lineage });
  const results = lineage.activeTeams.map((currentTeam) =>
    buildArchiveResult({
      trades,
      lineage,
      currentTeam,
      context,
    }),
  );
  const directory = results.map((result) => result.archive);
  const membershipRows = results.flatMap(
    (result) => result.membershipRows,
  );

  return {
    directory,
    membershipRows,
    lineage,
  };
}

export function buildNbaTeamDirectory({ trades, teams }) {
  return buildDirectoryResult({ trades, teams }).directory;
}

export function buildNbaTeamArchive({ trades, teams, teamSlug }) {
  if (!Array.isArray(trades) || !Array.isArray(teams)) {
    throw new TypeError("buildNbaTeamArchive requires trade and team arrays.");
  }

  return (
    buildDirectoryResult({ trades, teams }).directory.find(
      (team) => team.slug === clean(teamSlug),
    ) ?? null
  );
}

export function auditNbaTeamDirectoryOutcomes({ trades, teams }) {
  const {
    directory,
    membershipRows,
    lineage,
  } = buildDirectoryResult({ trades, teams });
  const rowsByTrade = new Map();

  for (const row of membershipRows) {
    const rows = rowsByTrade.get(row.canonicalTradeId) ?? [];
    rows.push(row);
    rowsByTrade.set(row.canonicalTradeId, rows);
  }

  const canonicalTwoTeamTrades = trades.filter(
    (trade) =>
      Array.isArray(trade?.teams) &&
      trade.teams.length === 2,
  );
  const canonicalMultiTeamTrades = trades.filter(
    (trade) =>
      Array.isArray(trade?.teams) &&
      trade.teams.length > 2,
  );
  const twoTeamRows = membershipRows.filter(
    (row) => row.teamCount === 2,
  );
  const twoTeamFallbackTradeIds = unique(
    twoTeamRows
      .filter((row) => row.method === "two-team-grade-fallback")
      .map((row) => row.canonicalTradeId),
  );
  const sourceOwnerFailures = unique(
    membershipRows
      .filter((row) => !row.ownerResolved)
      .map((row) => row.canonicalTradeId),
  );
  const multiTeamFallbackRows = membershipRows.filter(
    (row) =>
      row.teamCount > 2 &&
      row.method.includes("grade-fallback"),
  );
  const twoTeamSymmetryDefects = [];

  for (const [tradeId, rows] of rowsByTrade) {
    if (
      rows.length !== 2 ||
      rows[0].teamCount !== 2 ||
      rows.some((row) => !row.explicit)
    ) {
      continue;
    }

    const pair = rows
      .map((row) => row.outcome)
      .sort()
      .join("|");

    if (
      !new Set([
        "even|even",
        "loss|win",
        "unknown|unknown",
      ]).has(pair)
    ) {
      twoTeamSymmetryDefects.push({
        tradeId,
        pair,
      });
    }
  }

  let expectedTwoTeamMembershipRows = 0;
  let fullyRepresentedTwoTeamTrades = 0;
  let oneCurrentFranchiseTwoTeamTrades = 0;
  let zeroCurrentFranchiseTwoTeamTrades = 0;
  let representationMismatches = 0;

  for (const trade of canonicalTwoTeamTrades) {
    const expectedCurrentSlugs = unique(
      trade.teams
        .map((slug) =>
          lineage.getCurrentSlug(clean(slug)) ??
          (lineage.activeTeamBySlug.has(clean(slug))
            ? clean(slug)
            : null),
        )
        .filter(Boolean),
    ).sort();
    const actualCurrentSlugs = unique(
      (rowsByTrade.get(clean(trade.id)) ?? []).map(
        (row) => row.currentSlug,
      ),
    ).sort();

    expectedTwoTeamMembershipRows += expectedCurrentSlugs.length;

    if (expectedCurrentSlugs.length === 2) {
      fullyRepresentedTwoTeamTrades += 1;
    } else if (expectedCurrentSlugs.length === 1) {
      oneCurrentFranchiseTwoTeamTrades += 1;
    } else {
      zeroCurrentFranchiseTwoTeamTrades += 1;
    }

    if (
      JSON.stringify(expectedCurrentSlugs) !==
      JSON.stringify(actualCurrentSlugs)
    ) {
      representationMismatches += 1;
    }
  }

  const totals = directory.reduce(
    (sum, team) => ({
      trades: sum.trades + team.total,
      wins: sum.wins + team.wins,
      losses: sum.losses + team.losses,
      even: sum.even + team.even,
      unknown: sum.unknown + team.unknown,
    }),
    {
      trades: 0,
      wins: 0,
      losses: 0,
      even: 0,
      unknown: 0,
    },
  );

  return {
    canonicalTrades: trades.length,
    currentFranchises: directory.length,
    canonicalTwoTeamTrades: canonicalTwoTeamTrades.length,
    canonicalMultiTeamTrades: canonicalMultiTeamTrades.length,
    franchiseTradeMemberships: membershipRows.length,
    twoTeamCurrentFranchiseMembershipRows: twoTeamRows.length,
    expectedTwoTeamCurrentFranchiseMembershipRows:
      expectedTwoTeamMembershipRows,
    fullyRepresentedTwoTeamTrades,
    oneCurrentFranchiseTwoTeamTrades,
    zeroCurrentFranchiseTwoTeamTrades,
    representationMismatches,
    sourceOwnerFailures: sourceOwnerFailures.length,
    twoTeamAuthorityFallbackTrades:
      twoTeamFallbackTradeIds.length,
    twoTeamSymmetryDefects:
      twoTeamSymmetryDefects.length,
    multiTeamGradeFallbackMemberships:
      multiTeamFallbackRows.length,
    explicitSignalsUsed: membershipRows.filter(
      (row) => row.explicit,
    ).length,
    totals,
  };
}
