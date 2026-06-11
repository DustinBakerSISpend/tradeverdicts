const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const [,, targetTeam, workbookPath, modeArg] = process.argv;
const mode = modeArg || '--dry-run';

if (!targetTeam || !workbookPath) {
  console.error('Usage: node scripts/backfill-team-grades-from-source.cjs <team-slug> <workbook-path> [--apply]');
  process.exit(1);
}

const APPLY = mode === '--apply';
const ALLOWED_GRADES = new Set(['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F']);

const ROOT = process.cwd();
const tradesPath = path.join(ROOT, 'src/data/nfl/trades.json');

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeGrade(value) {
  return String(value || '').trim().toUpperCase();
}

function reportName(slug) {
  return `${slug}-grade-backfill-report.json`;
}

const workbook = XLSX.readFile(workbookPath);
const sheet = workbook.Sheets['Trade Database'];

if (!sheet) {
  console.error('Missing sheet: Trade Database');
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
const headers = Object.keys(rows[0] || {});

const gradeColumns = headers.filter(h => /grade$/i.test(h));
const preferredNeedle = titleFromSlug(targetTeam).replace(/\b\w/g, c => c.toUpperCase());
const targetGradeColumn =
  gradeColumns.find(h => h.toLowerCase().includes(preferredNeedle.toLowerCase().split(' ').at(-1)) && !/^partner grade$/i.test(h)) ||
  gradeColumns.find(h => !/^partner grade$/i.test(h));

if (!headers.includes('Trade ID')) {
  console.error('Missing required column: Trade ID');
  process.exit(1);
}

if (!targetGradeColumn) {
  console.error('Could not identify target grade column.');
  console.error('Grade columns found:', gradeColumns);
  process.exit(1);
}

const sourceByTradeId = new Map();

for (const row of rows) {
  const id = String(row['Trade ID'] || '').trim();
  const grade = normalizeGrade(row[targetGradeColumn]);

  if (!id || !grade) continue;

  sourceByTradeId.set(id, {
    grade,
    row,
  });
}

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const changes = [];
const skipped = {
  notTargetTeamTrade: 0,
  missingSource: 0,
  invalidSourceGrade: 0,
  alreadyHasGrade: 0,
};

for (const trade of trades) {
  if (!Array.isArray(trade.teams) || !trade.teams.includes(targetTeam)) {
    skipped.notTargetTeamTrade++;
    continue;
  }

  const source = sourceByTradeId.get(trade.id);

  if (!source) {
    skipped.missingSource++;
    continue;
  }

  if (!ALLOWED_GRADES.has(source.grade)) {
    skipped.invalidSourceGrade++;
    continue;
  }

  trade.grades = trade.grades || {};
  const current = String(trade.grades[targetTeam] || '').trim();

  if (current && current !== 'Hold - Provisional') {
    skipped.alreadyHasGrade++;
    continue;
  }

  changes.push({
    id: trade.id,
    date: trade.date,
    currentGrade: current || null,
    newGrade: source.grade,
    title: trade.title || trade.summary || '',
  });

  if (APPLY) {
    trade.grades[targetTeam] = source.grade;
  }
}

const report = {
  mode: APPLY ? 'apply' : 'dry-run',
  targetTeam,
  workbookPath,
  sheetName: 'Trade Database',
  targetGradeColumn,
  allowedGrades: [...ALLOWED_GRADES],
  changeCount: changes.length,
  changes,
  skipped,
};

const reportPath = path.join(ROOT, 'src/data/nfl', reportName(targetTeam));

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${changes.length} grade backfills for ${targetTeam}`);
console.log(`grade column: ${targetGradeColumn}`);
console.log(`wrote: ${reportPath}`);

for (const change of changes) {
  console.log(`${change.id} | ${change.currentGrade || '(blank)'} -> ${change.newGrade} | ${change.date}`);
}
