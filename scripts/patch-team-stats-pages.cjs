const fs = require('fs');

let p = 'src/pages/teams/index.astro';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('import { getTeamStats }')) {
  s = s.replace(
    'import trades from "../../data/nfl/trades.json";',
    'import trades from "../../data/nfl/trades.json";\nimport { getTeamStats } from "../../utils/teamStats.js";'
  );
}

s = s.replace(
  /  const displayName = NFL_TEAMS\.find\(\(team\) => team\[1\] === slug\)\?\.\[0\] \|\| slug;[\s\S]*?  const even = teamTrades\.filter\([\s\S]*?\)\.length;/,
  '  const { wins, losses, even } = getTeamStats(trades, slug);'
);

s = s.replace(
  'losses: teamTrades.length - wins - even,',
  'losses,'
);

fs.writeFileSync(p, s);

p = 'src/pages/teams/[team].astro';
s = fs.readFileSync(p, 'utf8');

if (!s.includes('import { getTeamStats }')) {
  s = s.replace(
    'import trades from "../../data/nfl/trades.json";',
    'import trades from "../../data/nfl/trades.json";\nimport { getTeamStats } from "../../utils/teamStats.js";'
  );
}

s = s.replace(
  /const teamShortName = teamDisplayName\.split\(" "\)\.at\(-1\)\.toLowerCase\(\);[\s\S]*?const losses = teamTrades\.length - wins - even;/,
  'const { wins, losses, even } = getTeamStats(trades, team);'
);

fs.writeFileSync(p, s);

console.log('patched team stats pages');
