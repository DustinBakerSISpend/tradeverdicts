import { resolveTeamLogo } from './teamLogos.mjs';
// Optional fields only for public records, using original raw identity and canonical season.
// For normalized franchise displays, the exact raw team must still be present.
export function getPublicTradeLogoFields(trade, displayedTeams = trade?.teams, resolver = resolveTeamLogo) {
  if (!Array.isArray(trade?.teams) || !Array.isArray(displayedTeams) || !Number.isInteger(trade.season)) return {};
  const display = new Set(displayedTeams);
  const entries = [...new Set(trade.teams)].filter(teamSlug => display.has(teamSlug)).flatMap(teamSlug => {
    const src = resolver({ league: 'nfl', teamSlug, season: trade.season });
    return src ? [[teamSlug, src]] : [];
  });
  return entries.length ? { teamLogos: Object.fromEntries(entries) } : {};
}
