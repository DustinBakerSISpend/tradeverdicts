import { resolveTeamLogo, teamLogoRegistry } from './teamLogos.mjs';

// Homepage navigation is current-season art only, never a guess from trade-era data.
const counts = { nfl: 32, nba: 30 };
export function currentTeamLogoLinks({ league, season, teamSlugs }, registry = teamLogoRegistry, resolve = resolveTeamLogo) {
  if (!Object.hasOwn(counts, league) || !Number.isInteger(season) || !Array.isArray(teamSlugs)) return [];
  if (teamSlugs.length !== counts[league] || new Set(teamSlugs).size !== counts[league]) return [];
  const rows = [];
  for (const teamSlug of teamSlugs) {
    if (typeof teamSlug !== 'string' || !Object.hasOwn(registry[league] || {}, teamSlug)) return [];
    const team = registry[league][teamSlug];
    const src = resolve({ league, teamSlug, season });
    if (!src || typeof team.name !== 'string' || !team.name.trim()) return [];
    rows.push({ name: team.name, src, href: (league === 'nba' ? '/nba' : '') + '/teams/' + teamSlug + '/' });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en-US'));
}
