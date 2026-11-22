import { resolveTeamLogo } from './teamLogos.mjs';
import { getCanonicalFranchiseSlug } from './teamRegistry.js';
// Optional fields only for public records. A normalized display may use the modern
// franchise mark only if the raw participant has a proven canonical lineage.
export function getPublicTradeLogoFields(trade, displayedTeams = trade?.teams, resolver = resolveTeamLogo) {
  if (!Array.isArray(trade?.teams) || !Array.isArray(displayedTeams) || !Number.isInteger(trade.season)) return {};
  const raw = new Set(trade.teams);
  const canonical = new Set(trade.teams.map(getCanonicalFranchiseSlug).filter(Boolean));
  const entries = [...new Set(displayedTeams)].filter(teamSlug => raw.has(teamSlug) || canonical.has(teamSlug)).flatMap(teamSlug => {
    const src = resolver({ league: 'nfl', teamSlug, season: trade.season });
    return src ? [[teamSlug, src]] : [];
  });
  return entries.length ? { teamLogos: Object.fromEntries(entries) } : {};
}
