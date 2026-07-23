#!/usr/bin/env node
import { expandAuditedNbaAssetText, parseAuditedNbaAssetText } from "../../src/lib/nba/parse-audited-asset-text.mjs";

const phoenixContracts = [2024, 2026, 2028, 2030].map((draftYear) => ({
  type: "pick_swap_contract",
  contractKey: `washington-wizards|phoenix-suns|${draftYear}|1|${draftYear === 2024 ? "not_exercised" : "unknown"}`,
  holderTeam: "washington-wizards",
  subjectTeam: "phoenix-suns",
  draftYear,
  round: 1,
  exerciseStatus: draftYear === 2024 ? "not_exercised" : "unknown",
  sourceRepresentations: [],
  sourceRepresentationCount: 2,
  duplicateSourceRepresentation: true,
}));

const expanded = expandAuditedNbaAssetText(
  "2024, 2026, 2028, 2030 first round pick swap rights (with Suns)",
  { swapContracts: phoenixContracts },
);
if (
  expanded.length !== 4 ||
  expanded.some((asset) => asset.type !== "pick_swap") ||
  new Set(expanded.map((asset) => asset.contractKey)).size !== 4
) {
  throw new Error(`Multi-year swap expansion failed: ${JSON.stringify(expanded, null, 2)}`);
}

const rights = parseAuditedNbaAssetText(
  "Draft rights to Kyshawn George (#24)",
  { draftYear: 2024 },
);
if (
  rights.type !== "draft_rights" ||
  rights.playerName !== "Kyshawn George" ||
  rights.overall !== 24 ||
  rights.draftYear !== 2024
) {
  throw new Error(`Draft-rights identity repair failed: ${JSON.stringify(rights, null, 2)}`);
}

const waived = parseAuditedNbaAssetText("Reggie Jackson (waived)");
if (
  waived.type !== "player" ||
  waived.playerName !== "Reggie Jackson" ||
  waived.transactionContext !== "waived"
) {
  throw new Error(`Transaction-context repair failed: ${JSON.stringify(waived, null, 2)}`);
}

const memphisContract = {
  type: "pick_swap_contract",
  contractKey: "memphis-grizzlies|unknown-subject|2032|2|unknown",
  holderTeam: "memphis-grizzlies",
  subjectTeam: null,
  draftYear: 2032,
  round: 2,
  exerciseStatus: "unknown",
  sourceRepresentations: [{
    direction: "sent",
    assetIndex: 2,
    displayText: "Grizzlies option to swap 2032 second round picks with Wizards) (?-?)**",
  }],
  sourceRepresentationCount: 2,
  duplicateSourceRepresentation: true,
};
const memphisSwap = expandAuditedNbaAssetText(
  "2032 second round swap rights",
  { swapContracts: [memphisContract] },
)[0];
if (
  memphisSwap.type !== "pick_swap" ||
  memphisSwap.holderTeam !== "memphis-grizzlies" ||
  memphisSwap.subjectTeam !== "washington-wizards" ||
  memphisSwap.contractKey !== "memphis-grizzlies|washington-wizards|2032|2|unknown"
) {
  throw new Error(`Memphis/Washington swap repair failed: ${JSON.stringify(memphisSwap, null, 2)}`);
}

console.log(JSON.stringify({
  result: "PASS",
  phase: "2J",
  expandedPhoenixSwapContracts: expanded.length,
  draftRightsIdentityClean: true,
  transactionContextSeparated: true,
  memphisSwapDirectionResolved: true,
  canonicalImports: 0,
  repositoryWrites: false,
}, null, 2));
