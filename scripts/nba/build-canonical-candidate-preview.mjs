#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

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
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  const nonEmpty = rows.filter((entry) => entry.some((cell) => cell !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((header) => header.replace(/^\uFEFF/, ''));
  return nonEmpty.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeSpace(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function splitAssets(value) {
  return normalizeSpace(value)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

const args = parseArgs(process.argv);
for (const required of ['audit-csv', 'preview', 'matches', 'decisions', 'output-json', 'output-csv']) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const [auditText, previewText, matchText, decisionText] = await Promise.all([
  readFile(args['audit-csv'], 'utf8'),
  readFile(args.preview, 'utf8'),
  readFile(args.matches, 'utf8'),
  readFile(args.decisions, 'utf8'),
]);

const auditRows = parseCsv(auditText);
const preview = JSON.parse(previewText);
const matches = JSON.parse(matchText);
const decisions = JSON.parse(decisionText);

if (auditRows.length !== 27) throw new Error(`Expected 27 audited rows; found ${auditRows.length}.`);
if (preview.submissionCount !== 27) throw new Error('Wizards preview must contain 27 submissions.');
if (matches.counts?.exact !== 2) throw new Error('Expected two exact Lakers perspective matches.');
if (decisions.resolutions?.length !== 6) throw new Error('Expected six official-source resolutions.');

const previewByRaw = new Map(
  preview.normalized.map((submission) => [normalizeSpace(submission.rawText), submission])
);
const matchBySubmission = new Map(
  matches.results.map((result) => [result.submissionId, result])
);
const decisionByTrade = new Map(
  decisions.resolutions.map((decision) => [decision.tradeId, decision])
);

const candidates = auditRows.map((auditRow) => {
  const source = previewByRaw.get(normalizeSpace(auditRow['Source Raw Text']));
  if (!source) throw new Error(`Could not match raw perspective for ${auditRow['Trade ID']}.`);

  const match = matchBySubmission.get(source.submissionId);
  if (!match) throw new Error(`Missing cross-team match record for ${source.submissionId}.`);

  const decision = decisionByTrade.get(auditRow['Trade ID']) ?? null;
  const matchedLakers = match.status === 'exact-perspective-match'
    ? match.candidates?.[0]?.submissionId ?? null
    : null;

  const sourcePerspectives = [{
    submissionId: source.submissionId,
    batchId: source.batchId,
    sourceTeam: source.sourceTeam,
    editorialStatus: 'meta-grok-audited',
  }];

  if (matchedLakers) {
    sourcePerspectives.push({
      submissionId: matchedLakers,
      batchId: matches.leftBatchId,
      sourceTeam: 'los-angeles-lakers',
      editorialStatus: 'source-perspective-linked-editorial-pending',
    });
  }

  return {
    candidateId: `nba-candidate-${auditRow['Trade ID'].toLowerCase()}`,
    tradeId: auditRow['Trade ID'],
    canonicalDate: decision?.canonicalDate ?? auditRow.Date,
    canonicalTeams: decision?.canonicalTeams ?? source.teams,
    candidateAction: matchedLakers
      ? 'create-shared-canonical-candidate'
      : 'create-new-canonical-candidate',
    crossTeamStatus: match.status,
    sourcePerspectives,
    assets: {
      washingtonReceived: splitAssets(auditRow['Wizards Received']),
      washingtonSent: splitAssets(auditRow['Wizards Sent']),
      partnerReceived: splitAssets(auditRow['Partner Received']),
      partnerSent: splitAssets(auditRow['Partner Sent']),
    },
    editorial: {
      primaryTeam: auditRow['Primary Team'],
      tradePartner: auditRow['Trade Partner'],
      wizardsGrade: auditRow['Wizards Grade'],
      partnerGrade: auditRow['Partner Grade'],
      confidence: auditRow.Confidence,
      reviewStatus: auditRow['Review Status'],
      tradeTier: auditRow['Trade Tier'],
      wizardsOutcomeSynopsis: auditRow['Wizards Outcome Synopsis'],
      partnerOutcomeSynopsis: auditRow['Partner Outcome Synopsis'],
      cleanupNotes: auditRow['Cleanup Notes'],
      finalAuditNotes: auditRow['Final Audit / QA Notes'],
    },
    auditResolution: decision,
    canonicalDataReady: true,
    publicationReady: false,
    publishStatus: 'hold',
    indexEligible: false,
    adEligible: false,
    automaticMerge: false,
    canonicalImportPerformed: false,
    sourceContentHash: source.sourceContentHash,
    auditedContentHash: hash(JSON.stringify(auditRow)),
    manualReconciliationBlockers: [],
  };
});

const tradeIds = new Set(candidates.map((candidate) => candidate.tradeId));
if (tradeIds.size !== 27) throw new Error('Duplicate Trade IDs were found.');
if (candidates.some((candidate) => candidate.manualReconciliationBlockers.length)) {
  throw new Error('A candidate still contains a manual reconciliation blocker.');
}
if (candidates.some((candidate) => candidate.publishStatus !== 'hold')) {
  throw new Error('Every candidate must remain on publication hold.');
}

const counts = {
  candidates: candidates.length,
  newCanonicalCandidates: candidates.filter(
    (candidate) => candidate.candidateAction === 'create-new-canonical-candidate'
  ).length,
  sharedCanonicalCandidates: candidates.filter(
    (candidate) => candidate.candidateAction === 'create-shared-canonical-candidate'
  ).length,
  sourcePerspectives: candidates.reduce(
    (sum, candidate) => sum + candidate.sourcePerspectives.length,
    0
  ),
  officialSourceResolutions: decisions.resolutions.length,
  manualReconciliationBlockers: candidates.reduce(
    (sum, candidate) => sum + candidate.manualReconciliationBlockers.length,
    0
  ),
};

const output = {
  mode: 'DRY_RUN_CANONICAL_CANDIDATE_PREVIEW_ONLY',
  batchId: decisions.batchId,
  auditStatus: decisions.auditStatus,
  canonicalDatePolicy: decisions.canonicalDatePolicy,
  counts,
  candidates,
  canonicalImports: 0,
  repositoryWrites: false,
  automaticMerges: false,
  routesCreated: false,
  buildPerformed: false,
  pushPerformed: false,
  deployPerformed: false,
};

await mkdir(path.dirname(args['output-json']), { recursive: true });
await mkdir(path.dirname(args['output-csv']), { recursive: true });
await writeFile(args['output-json'], `${JSON.stringify(output, null, 2)}\n`, 'utf8');

const csvHeaders = [
  'Candidate ID','Trade ID','Canonical Date','Canonical Teams','Candidate Action',
  'Cross-Team Status','Perspective Count','Matched Lakers Submission',
  'Wizards Grade','Partner Grade','Confidence','Review Status','Trade Tier',
  'Canonical Data Ready','Publication Ready','Publish Status',
  'Official Resolution','Official Source'
];
const csvRows = candidates.map((candidate) => [
  candidate.candidateId,
  candidate.tradeId,
  candidate.canonicalDate,
  candidate.canonicalTeams.join('; '),
  candidate.candidateAction,
  candidate.crossTeamStatus,
  candidate.sourcePerspectives.length,
  candidate.sourcePerspectives.find((perspective) =>
    perspective.sourceTeam === 'los-angeles-lakers'
  )?.submissionId ?? '',
  candidate.editorial.wizardsGrade,
  candidate.editorial.partnerGrade,
  candidate.editorial.confidence,
  candidate.editorial.reviewStatus,
  candidate.editorial.tradeTier,
  candidate.canonicalDataReady,
  candidate.publicationReady,
  candidate.publishStatus,
  candidate.auditResolution?.resolution ?? '',
  candidate.auditResolution?.sourceUrl ?? '',
]);
await writeFile(
  args['output-csv'],
  `${[csvHeaders, ...csvRows].map((row) => row.map(csvEscape).join(',')).join('\n')}\n`,
  'utf8'
);

console.log(JSON.stringify({
  result: 'PASS',
  phase: '2H',
  ...counts,
  canonicalImports: 0,
  repositoryWrites: false,
  automaticMerges: false,
  publicationReady: false,
}, null, 2));
