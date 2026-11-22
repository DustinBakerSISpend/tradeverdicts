import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import manifest from '../data/team-logos.json' with { type: 'json' };
// Used only at build/server render: an era-specific local asset must be approved.
export function resolveEraTeamLogo({ league='nfl', teamSlug, season }, registry=manifest, fileExists=existsSync) {
  if (typeof teamSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(teamSlug)) return null;
  if (!Number.isInteger(season) || !Object.hasOwn(registry,league)) return null;
  const team=registry[league]?.[teamSlug];
  if (!team || !Object.hasOwn(registry[league],teamSlug) || !Array.isArray(team.assets)) return null;
  const eligible=team.assets.filter(asset=>asset.approved===true && typeof asset.rightsEvidence==='string' && asset.rightsEvidence.trim() && typeof asset.provenance==='string' && asset.provenance.trim() && Number.isInteger(asset.fromSeason) && Number.isInteger(asset.throughSeason) && season>=asset.fromSeason && season<=asset.throughSeason && typeof asset.src==='string' && asset.src.startsWith('/team-logos/'+league+'/'+teamSlug+'/') && /^\/team-logos\/(?:nfl|nba)\/[a-z0-9-]+\/[a-z0-9-]+\.(?:svg|png|webp)$/.test(asset.src));
  if (eligible.length!==1) return null; // Avoid ambiguous era art.
  const src=eligible[0].src;
  // Source imports retain their original location; Astro bundles this module under dist/.prerender.
  // The npm build executes from the project root with its public directory.
  const sourceAsset=fileURLToPath(new URL('../../public'+src,import.meta.url));
  const buildAsset=resolve(process.cwd(),'public','.'+src);
  const disk=fileExists(sourceAsset) ? sourceAsset : buildAsset;
  return fileExists(disk) ? src : null;
}

// Editorial identifiers: prefer a verified era mark, otherwise use the approved
// present-day mark of the SAME displayed franchise. Never depict a different or
// defunct historical team as a modern franchise, and never invent an era match.
export function resolveTeamLogo({ league='nfl', teamSlug, season }, registry=manifest, fileExists=existsSync) {
  const exact = resolveEraTeamLogo({ league, teamSlug, season }, registry, fileExists);
  if (exact) return exact;
  if (!Number.isInteger(season) || typeof teamSlug !== 'string' || !Object.hasOwn(registry, league) || !Object.hasOwn(registry[league], teamSlug)) return null;
  const assets = registry[league][teamSlug]?.assets;
  if (!Array.isArray(assets)) return null;
  // An ambiguous or unavailable era-specific selection must remain suppressed.
  if (assets.some(asset => asset.approved === true && season >= asset.fromSeason && season <= asset.throughSeason)) return null;
  const current = assets.filter(asset => asset.approved === true && asset.src === `/team-logos/${league}/${teamSlug}/current.png`);
  if (current.length !== 1) return null;
  return resolveEraTeamLogo({ league, teamSlug, season: current[0].throughSeason }, registry, fileExists);
}
// Older NBA records retain a canonical season label instead of a numeric field.
export function getTeamLogoSeason(trade) {
  if (Number.isInteger(trade?.season)) return trade.season;
  const match = typeof trade?.seasonLabel === 'string' && trade.seasonLabel.match(/^(\d{4})-(\d{2})$/);
  if (!match || (Number(match[1]) + 1) % 100 !== Number(match[2])) return undefined;
  return Number(match[1]);
}
export const teamLogoRegistry=manifest;
