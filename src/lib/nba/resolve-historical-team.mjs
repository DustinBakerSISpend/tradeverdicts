function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[’']/gu, "")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

const removableSuffixes = [
  /\s+\(date approximate\)$/iu,
  /\s+\(per Jazz media guide\)$/iu,
  /\s+\(trade was made official on 07-19\)$/iu,
  /\s+\(date per NBA Register\)$/iu,
  /\s+\(AP\)$/iu,
  /\s+\(per NBAGuide\)$/iu,
  /\s+\((?:BAA|NBL)\)$/iu,
];

export function cleanHistoricalTeamLabel(value) {
  let output = String(value ?? "").trim();

  if (/^Packers\s+\(trade including/iu.test(output)) {
    return "Packers";
  }

  for (const pattern of removableSuffixes) {
    output = output.replace(pattern, "");
  }

  return output.trim();
}

function validForDate(rule, tradeDate) {
  if (rule.validFrom && tradeDate < rule.validFrom) return false;
  if (rule.validTo && tradeDate > rule.validTo) return false;
  return true;
}

function buildFallbackAliases(teams) {
  const aliases = new Map();

  for (const team of teams) {
    const values = [
      team.slug,
      team.name,
      team.abbreviation,
      ...(Array.isArray(team.historicalAliases) ? team.historicalAliases : []),
    ];

    for (const value of values) {
      const key = normalizeText(value);
      if (!key) continue;
      if (!aliases.has(key)) aliases.set(key, []);
      aliases.get(key).push(team.slug);
    }
  }

  return aliases;
}

export function createHistoricalNbaTeamResolver({ teams, lineage }) {
  if (!Array.isArray(teams)) throw new TypeError("teams must be an array.");
  if (!lineage || !Array.isArray(lineage.rules)) {
    throw new TypeError("lineage.rules must be an array.");
  }

  const teamBySlug = new Map(teams.map((team) => [team.slug, team]));
  const rulesByLabel = new Map();

  for (const rule of lineage.rules) {
    const labelKey = normalizeText(rule.label);
    if (!labelKey) throw new Error(`Historical team rule ${rule.id} has no label.`);
    if (!teamBySlug.has(rule.team)) {
      throw new Error(`Historical team rule ${rule.id} references missing team ${rule.team}.`);
    }
    if (!rulesByLabel.has(labelKey)) rulesByLabel.set(labelKey, []);
    rulesByLabel.get(labelKey).push(rule);
  }

  const fallbackAliases = buildFallbackAliases(teams);

  return Object.freeze({
    resolve(label, tradeDate) {
      const cleanedLabel = cleanHistoricalTeamLabel(label);
      const key = normalizeText(cleanedLabel);
      const date = String(tradeDate ?? "").trim();

      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
        return {
          status: "invalid-date",
          label: cleanedLabel,
          tradeDate: date,
          team: null,
          rule: null,
        };
      }

      const candidates = (rulesByLabel.get(key) ?? []).filter((rule) =>
        validForDate(rule, date),
      );

      if (candidates.length === 1) {
        const rule = candidates[0];
        return {
          status: "resolved",
          label: cleanedLabel,
          tradeDate: date,
          team: teamBySlug.get(rule.team),
          rule,
        };
      }

      if (candidates.length > 1) {
        return {
          status: "ambiguous",
          label: cleanedLabel,
          tradeDate: date,
          team: null,
          rule: null,
          candidates: candidates.map((rule) => rule.id),
        };
      }

      const fallback = [...new Set(fallbackAliases.get(key) ?? [])];
      if (fallback.length === 1) {
        return {
          status: "resolved-fallback",
          label: cleanedLabel,
          tradeDate: date,
          team: teamBySlug.get(fallback[0]),
          rule: null,
        };
      }

      return {
        status: fallback.length > 1 ? "ambiguous-fallback" : "not-found",
        label: cleanedLabel,
        tradeDate: date,
        team: null,
        rule: null,
        candidates: fallback,
      };
    },
  });
}
