# Minnesota Timberwolves Phase 20H Guarded Private Import Contract

Status: PRIVATE / NOINDEX / AD-FREE
Publication authorized: NO
Indexing authorized: NO
Push authorized: NO
Deployment authorized: NO

This import is derived deterministically from the frozen Milwaukee Bucks Phase 19H
importer/tester implementation seeds captured by Minnesota Phase 20G.

Frozen Minnesota import partition:
- 97 import-ready packages
- 23 held packages
- 1 structural/evidence exclusion
- 38 canonical creates
- 59 Minnesota perspective appends
- 35 ready-required proposed player shells
- 13 held-only proposed player shells
- 300 ready relationship references
- 93 held relationship references
- 194 ready team dependencies
- 75 held team dependencies
- 0 Phase 20E ambiguous identity occurrences
- 0 missing team dependencies
- 0 existing Minnesota perspective holds

The first-pass importer creates all 35 ready-required proposed shells. No
existing-player override is authorized in this R1 contract. The full private-query
invariant must pass in shadow before any live write begins. If stricter exact-name
normalization reveals an identity collision, the phase must fail in shadow and a
read-only exact-identity diagnostic is required before any override can be authorized.

Only these six repository paths may change:
1. scripts/nba/import-minnesota-timberwolves-phase-20h-private-batch.mjs
2. scripts/nba/test-minnesota-timberwolves-phase-20h-private-batch.mjs
3. src/data/nba/minnesota-timberwolves-phase-20h-contract.md
4. src/data/nba/imports/minnesota-timberwolves-phase-20h-private-import.json
5. src/data/nba/players.json
6. src/data/nba/trades.json

teams.json must remain byte-identical.

Held packages, held relationships, held-only player shells, routing holds,
recent-provisional rows, and the historical source-evidence hold remain deferred.
No public/index authorization is created by this phase.
