import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import manifest from '../data/team-logos.json' with { type: 'json' };
// Used only at build/server render: a local asset must be approved and match the trade era.
export function resolveTeamLogo({ league='nfl', teamSlug, season }, registry=manifest, fileExists=existsSync) {
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
export const teamLogoRegistry=manifest;
