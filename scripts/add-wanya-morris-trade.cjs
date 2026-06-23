const fs = require('fs');

const path = 'src/data/nfl/trades.json';
const trades = JSON.parse(fs.readFileSync(path, 'utf8'));

const id = 'ATL-2026-06-11-0520';
const slug = 'wanya-morris-kansas-city-chiefs-2026';

if (trades.some(t => t.id === id || t.slug === slug)) {
  console.error('Trade already exists:', id, slug);
  process.exit(1);
}

const trade = {
  id,
  canonicalKey: '2026-06-11|atlanta-falcons|kansas-city-chiefs|wanya morris|2027 sixth round pick|2027 seventh round pick',
  dateTeamsKey: '2026-06-11|atlanta-falcons|kansas-city-chiefs',
  slug,
  league: 'NFL',
  tradeDate: '2026-06-11',
  season: 2026,
  teams: ['atlanta-falcons', 'kansas-city-chiefs'],
  assetsReceived: {
    'atlanta-falcons': [
      { type: 'player', asset: 'Wanya Morris' },
      { type: 'pick', asset: '2027 seventh round pick' }
    ],
    'kansas-city-chiefs': [
      { type: 'pick', asset: '2027 sixth round pick' }
    ]
  },
  tier: 'minor',
  publishStatus: 'ready',
  verdict: 'Atlanta Falcons Win',
  grades: {
    'atlanta-falcons': 'C+',
    'kansas-city-chiefs': 'C'
  },
  confidence: 'high',
  summary: 'Atlanta acquired offensive tackle Wanya Morris and a 2027 seventh round pick from Kansas City for a 2027 sixth round pick. The Falcons get a young, experienced tackle with real NFL starting experience while only sliding down one late-round tier in a future draft. Kansas City clears a depth-chart piece and improves its 2027 draft slot, but Atlanta receives the more useful football asset.',
  partnerSummary: 'Kansas City moved Wanya Morris and a 2027 seventh round pick to Atlanta for a 2027 sixth round pick. The Chiefs get a modest pick upgrade and move forward with their preferred tackle depth, but the return is light for a former third-round pick with 43 games and 16 starts of NFL experience.',
  analysis: 'This is a small transaction, but it is exactly the kind of trade that can matter more in September than it looks in June. Atlanta acquired Wanya Morris and a 2027 seventh round pick from Kansas City for a 2027 sixth round pick, giving the Falcons a young offensive tackle with starting experience without surrendering a premium draft asset. Morris was a 2023 third-round pick and had appeared in 43 games with 16 starts, including 11 starts during Kansas City’s 2024 Super Bowl season. For Atlanta, the appeal is simple: offensive line depth is expensive, swing tackles are hard to find, and moving from a future sixth to a future seventh is a manageable price for a player who has already handled real NFL snaps. Kansas City’s side is understandable, too. The Chiefs convert a player who appeared to be sliding down their tackle depth chart into a cleaner 2027 pick, and the move suggests confidence in their younger or cheaper offensive line options. Still, the value edge goes to Atlanta because the Falcons received the only player in the deal and did not pay much more than a late-round pick swap. The grade stays modest because Morris is not a locked-in starter and the trade is unlikely to reshape either franchise, but Atlanta made the more useful bet.',
  qaNotes: 'Manual 2026 live-trade entry. Deal terms cross-checked against ESPN, NFL.com, Falcons.com, Chiefs.com, and theScore reports.',
  sourceUrls: [
    'https://www.espn.com/nfl/story/_/id/49032113/falcons-acquire-wanya-morris-trade-chiefs-sources-say',
    'https://www.nfl.com/news/report-chiefs-trading-ot-wanya-morris-to-falcons',
    'https://www.atlantafalcons.com/news/falcons-trade-chiefs-2027-nfl-draft-wanya-morris',
    'https://www.chiefs.com/news/chiefs-trade-ot-wanya-morris-to-atlanta',
    'https://www.thescore.com/nfl/news/3552682/report-chiefs-trade-wanya-morris-to-falcons'
  ],
  perspectives: [
    {
      sourceTeam: 'atlanta-falcons',
      sourceTradeId: id,
      sourceRow: null,
      primaryTeam: 'atlanta-falcons',
      partnerTeam: 'kansas-city-chiefs',
      primarySummary: 'Atlanta acquired Wanya Morris and a 2027 seventh round pick from Kansas City for a 2027 sixth round pick.',
      partnerSummary: 'Kansas City received a 2027 sixth round pick and gave up Wanya Morris plus a 2027 seventh round pick.',
      primaryGrade: 'C+',
      partnerGrade: 'C',
      verdict: 'Atlanta Falcons Win',
      publishStatus: 'ready',
      qaNotes: 'Manual 2026 live-trade perspective.'
    },
    {
      sourceTeam: 'kansas-city-chiefs',
      sourceTradeId: id,
      sourceRow: null,
      primaryTeam: 'kansas-city-chiefs',
      partnerTeam: 'atlanta-falcons',
      primarySummary: 'Kansas City acquired a 2027 sixth round pick from Atlanta for Wanya Morris and a 2027 seventh round pick.',
      partnerSummary: 'Atlanta received Wanya Morris and a 2027 seventh round pick while sending a 2027 sixth round pick.',
      primaryGrade: 'C',
      partnerGrade: 'C+',
      verdict: 'Atlanta Falcons Win',
      publishStatus: 'ready',
      qaNotes: 'Manual 2026 live-trade perspective.'
    }
  ]
};

trades.push(trade);
trades.sort((a, b) => String(a.tradeDate || '').localeCompare(String(b.tradeDate || '')) || String(a.id).localeCompare(String(b.id)));

fs.writeFileSync(path, JSON.stringify(trades, null, 2) + '\n');

console.log('Added trade:', id, slug);
