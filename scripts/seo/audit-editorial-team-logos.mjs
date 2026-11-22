import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveTeamLogo, resolveEraTeamLogo, getTeamLogoSeason, teamLogoRegistry } from '../../src/utils/teamLogos.mjs';
import { getPublicTrades } from '../../src/utils/publicRecords.js';
import { getPublicTradeLogoFields } from '../../src/utils/publicTradeLogoFields.mjs';

for (const [league, count] of [['nfl', 32], ['nba', 30]]) {
  const registry = teamLogoRegistry[league];
  assert.equal(Object.keys(registry).length, count);
  for (const [teamSlug, team] of Object.entries(registry)) {
    const modern = resolveTeamLogo({ league, teamSlug, season: 2026 });
    assert.ok(modern, `${league}: ${teamSlug}`);
    assert.equal(resolveTeamLogo({ league, teamSlug, season: 1989 }), modern);
    assert.equal(resolveEraTeamLogo({ league, teamSlug, season: 1989 }), null);
    const hash = createHash('sha256').update(readFileSync(new URL('../../public' + modern, import.meta.url))).digest('hex');
    assert.equal(hash, team.assets.find(asset => asset.src === modern).sha256);
    assert.equal(resolveTeamLogo({ league, teamSlug, season: 1989 }, teamLogoRegistry, () => false), null);
  }
  const raw = JSON.parse(readFileSync(new URL(`../../src/data/${league}/trades.json`, import.meta.url), 'utf8'));
  const trades = league === 'nfl' ? getPublicTrades(raw) : raw;
  let participants = 0, marked = 0, rowsWithMarks = 0;
  const missing = new Map();
  for (const trade of trades) {
    let row = 0;
    const season = getTeamLogoSeason(trade);
    for (const teamSlug of trade.teams || []) {
      participants++;
      const logo = resolveTeamLogo({ league, teamSlug, season });
      if (logo) { marked++; row++; }
      else {
        assert.ok(!Object.hasOwn(registry, teamSlug), `Known team missed: ${trade.slug} ${teamSlug}`);
        missing.set(teamSlug, (missing.get(teamSlug) || 0) + 1);
      }
    }
    if (row) rowsWithMarks++;
  }
  if (league === 'nfl') for (const slug of ['nahshon-wright-dallas-cowboys-2024', 'herschel-walker-dallas-cowboys-1989']) {
    const trade = trades.find(t => t.slug === slug);
    assert.ok(trade, slug);
    assert.equal(Object.keys(getPublicTradeLogoFields(trade).teamLogos).length, 2);
  }
  console.log(JSON.stringify({ league, trades: trades.length, participants, marked, rowsWithMarks, missing: Object.fromEntries(missing) }));
}
assert.equal(getTeamLogoSeason({ seasonLabel: '1999-00' }), 1999);
assert.equal(getTeamLogoSeason({ seasonLabel: '1999-01' }), undefined);
assert.equal(resolveTeamLogo({ league: 'nba', teamSlug: 'seattle-supersonics', season: 2001 }), null);
assert.equal(resolveTeamLogo({ league: 'nfl', teamSlug: 'houston-oilers', season: 1995 }), null);
assert.equal(resolveTeamLogo({ league: 'nfl', teamSlug: 'dallas-cowboys', season: undefined }), null);
const normalized = getPublicTradeLogoFields({ season: 1995, teams: ['houston-oilers', 'dallas-cowboys'] }, ['tennessee-titans', 'dallas-cowboys', 'minnesota-vikings']);
assert.deepEqual(Object.keys(normalized.teamLogos), ['tennessee-titans', 'dallas-cowboys']);
const malformed = structuredClone(teamLogoRegistry);
malformed.nfl['dallas-cowboys'].assets.push({ ...malformed.nfl['dallas-cowboys'].assets[0] });
assert.equal(resolveTeamLogo({ league: 'nfl', teamSlug: 'dallas-cowboys', season: 1995 }, malformed), null);
console.log('PASS: 62 approved asset hashes, record coverage, era preference, safe exclusions, normalized participants.');
