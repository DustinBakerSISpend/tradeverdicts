const ALLOWED_ASSET_TYPES = new Set([
  "player",
  "draft_pick",
  "pick_swap",
  "draft_rights",
  "cash",
  "trade_exception",
  "conditional_asset",
  "future_consideration",
  "other",
]);

const ALLOWED_PUBLISH_STATUSES = new Set([
  "private",
  "review",
  "active",
  "suppressed",
]);

const ALLOWED_REVIEW_STATUSES = new Set([
  "unresolved",
  "validated",
  "manual-review",
  "approved",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateCanonicalNbaTrade(trade, teamRegistry) {
  const errors = [];

  if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
    return { valid: false, errors: ["Trade must be an object."] };
  }

  for (const field of [
    "id",
    "slug",
    "tradeDate",
    "seasonLabel",
    "summary",
    "verdict",
    "canonicalKey",
    "dateTeamsKey",
    "publishStatus",
    "reviewStatus",
    "createdAt",
    "updatedAt",
  ]) {
    if (!isNonEmptyString(trade[field])) {
      errors.push(`${field} must be a non-empty string.`);
    }
  }

  if (trade.league !== "nba") {
    errors.push("league must equal 'nba'.");
  }

  if (!Array.isArray(trade.teams) || trade.teams.length < 2) {
    errors.push("teams must contain at least two canonical team slugs.");
  } else {
    const uniqueTeams = new Set(trade.teams);
    if (uniqueTeams.size !== trade.teams.length) {
      errors.push("teams may not contain duplicates.");
    }

    for (const slug of trade.teams) {
      if (!teamRegistry?.hasSlug(slug)) {
        errors.push(`Unknown NBA team slug: ${slug}`);
      }
    }
  }

  if (!Array.isArray(trade.sourceTeams)) {
    errors.push("sourceTeams must be an array.");
  }

  if (!trade.assetsReceived || typeof trade.assetsReceived !== "object") {
    errors.push("assetsReceived must be an object keyed by team slug.");
  } else {
    for (const [teamSlug, assets] of Object.entries(trade.assetsReceived)) {
      if (!teamRegistry?.hasSlug(teamSlug)) {
        errors.push(`assetsReceived uses unknown team slug: ${teamSlug}`);
      }

      if (!Array.isArray(assets)) {
        errors.push(`assetsReceived.${teamSlug} must be an array.`);
        continue;
      }

      for (const [index, asset] of assets.entries()) {
        if (!asset || typeof asset !== "object") {
          errors.push(`assetsReceived.${teamSlug}[${index}] must be an object.`);
          continue;
        }

        if (!ALLOWED_ASSET_TYPES.has(asset.type)) {
          errors.push(
            `assetsReceived.${teamSlug}[${index}] has unsupported type '${asset.type}'.`,
          );
        }

        if (!isNonEmptyString(asset.displayText)) {
          errors.push(
            `assetsReceived.${teamSlug}[${index}].displayText is required.`,
          );
        }
      }
    }
  }

  if (!trade.grades || typeof trade.grades !== "object") {
    errors.push("grades must be an object keyed by team slug.");
  }

  if (!trade.perspectives || typeof trade.perspectives !== "object") {
    errors.push("perspectives must be an object keyed by team slug.");
  }

  if (!Array.isArray(trade.sources) || trade.sources.length === 0) {
    errors.push("sources must contain at least one provenance record.");
  }

  if (!ALLOWED_PUBLISH_STATUSES.has(trade.publishStatus)) {
    errors.push(`Unsupported publishStatus: ${trade.publishStatus}`);
  }

  if (!ALLOWED_REVIEW_STATUSES.has(trade.reviewStatus)) {
    errors.push(`Unsupported reviewStatus: ${trade.reviewStatus}`);
  }

  if (trade.indexEligible !== false) {
    errors.push("NBA trades must default to indexEligible=false.");
  }

  if (trade.adEligible !== false) {
    errors.push("NBA trades must default to adEligible=false.");
  }

  return { valid: errors.length === 0, errors };
}
