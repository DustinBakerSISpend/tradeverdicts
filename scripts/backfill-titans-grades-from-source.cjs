const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const APPLY = process.argv.includes('--apply');

const tradesPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'trades.json');
const sourcePath = path.join(__dirname, '..', 'data-imports', 'TradeVerdicts_Titans.xlsx');
const reportPath = path.join(__dirname, '..', 'src', 'data', 'nfl', 'titans-grade-backfill-report.json');

const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const wb = XLSX.readFile(sourcePath);
const ws = wb.Sheets['Trade Database'];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const sourceGrades = new Map();

for (const row of rows) {
  const id = String(row['Trade ID'] || '').trim();
  const grade = String(row['Titans/Oilers Grade'] || '').trim();
  if (id && grade) sourceGrades.set(id, grade);
}

const validGrades = new Set(['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F']);

const report = [];

for (const trade of trades) {
  if (!trade.teams?.includes('tennessee-titans')) continue;

  const current = String(trade.grades?.['tennessee-titans'] || '').trim();
  if (current) continue;

  const sourceGrade = sourceGrades.get(trade.id);
  if (!sourceGrade || !validGrades.has(sourceGrade)) continue;

  report.push({
    id: trade.id,
    tradeDate: trade.tradeDate,
    oldGrade: current,
    newGrade: sourceGrade,
    partnerGrades: Object.fromEntries(
      Object.entries(trade.grades || {}).filter(([team]) => team !== 'tennessee-titans')
    ),
    verdict: trade.verdict
  });

  if (APPLY) {
    if (!trade.grades || typeof trade.grades !== 'object' || Array.isArray(trade.grades)) {
      trade.grades = {};
    }

    trade.grades['tennessee-titans'] = sourceGrade;
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (APPLY) {
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
}

console.log(APPLY ? 'APPLY MODE' : 'DRY RUN MODE');
console.log('Source Titans grades:', sourceGrades.size);
console.log('Backfillable Titans blank grades:', report.length);
console.log('Report:', reportPath);

report.slice(0, 80).forEach(x => {
  console.log(`${x.id} | ${x.oldGrade || '(blank)'} -> ${x.newGrade} | verdict: ${x.verdict}`);
});
