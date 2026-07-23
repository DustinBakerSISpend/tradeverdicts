#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const auditPath = new URL('../../src/data/nba/audit/wizards-pilot-001-meta-grok-resolved.csv', import.meta.url);
const decisionsPath = new URL('../../src/data/nba/review/wizards-pilot-001-canonical-decisions.json', import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (value.length || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  const nonEmpty = rows.filter((entry) => entry.some((cell) => cell !== ''));
  const headers = nonEmpty[0].map((header) => header.replace(/^\uFEFF/, ''));
  return nonEmpty.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  );
}

const [auditBytes, decisionText] = await Promise.all([
  readFile(auditPath),
  readFile(decisionsPath, 'utf8'),
]);
const rows = parseCsv(auditBytes.toString('utf8'));
const decisions = JSON.parse(decisionText);
const byId = new Map(rows.map((row) => [row['Trade ID'], row]));

if (rows.length !== 27 || byId.size !== 27) throw new Error('Audit must contain 27 unique rows.');
if (decisions.resolutions.length !== 6) throw new Error('Six resolutions are required.');
if (rows.some((row) => !row['Wizards Grade'] || !row['Partner Grade'])) throw new Error('Missing grades.');
if (rows.some((row) => row['Publish Status'] !== 'Hold')) throw new Error('Every row must remain Hold.');

const expected = {
  'WAS-2025-0010': ['2025-02-06', 'Bucks, Knicks, Spurs'],
  'WAS-2023-0019': ['2023-06-24', 'Pacers, Suns'],
  'WAS-2023-0020': ['2023-06-28', 'Bulls'],
  'WAS-2026-0023': ['2026-01-09', 'Hawks'],
  'WAS-2026-0024': ['2026-02-05', 'Hornets, Mavericks'],
  'WAS-2026-0026': ['2026-07-07', 'Lakers'],
};
for (const [tradeId, [date, partner]] of Object.entries(expected)) {
  const row = byId.get(tradeId);
  if (!row || row.Date !== date || row['Trade Partner'] !== partner) {
    throw new Error(`Resolution mismatch for ${tradeId}.`);
  }
}

if (!byId.get('WAS-2023-0019')['Wizards Received'].includes('Bilal Coulibaly')) {
  throw new Error('Coulibaly must be restored to the official three-team Beal routing.');
}
if (!byId.get('WAS-2023-0019')['Wizards Sent'].includes('Jarace Walker')) {
  throw new Error('Jarace Walker must be restored to the official three-team Beal routing.');
}
if (!byId.get('WAS-2026-0024')['Cleanup Notes'].includes('Charlotte')) {
  throw new Error('Charlotte routing must be explicitly resolved.');
}

console.log(JSON.stringify({
  result: 'PASS',
  phase: '2H',
  auditedRows: rows.length,
  officialSourceResolutions: decisions.resolutions.length,
  allGradesPresent: true,
  publishHoldPreserved: true,
  auditCsvSha256: createHash('sha256').update(auditBytes).digest('hex'),
  canonicalImports: 0,
  repositoryWrites: false,
}, null, 2));
