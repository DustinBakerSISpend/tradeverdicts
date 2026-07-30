# New Orleans Pelicans Phase 21H Guarded Private Import Contract

Status: PRIVATE / NOINDEX / AD-FREE
Publication authorized: NO
Indexing authorized: NO
Push authorized: NO
Deployment authorized: NO

This is the first New Orleans Pelicans repository write phase. It consumes the
exact Phase 21B reconciled record extraction and the exact Phase 21F final
private-import partition frozen by Phase 21G-R2.

Frozen Pelicans import partition:
- 78 import-ready packages
- 19 held packages
- 4 linked/structural exclusions
- 39 canonical creates
- 39 Pelicans perspective appends
- 18 ready-required proposed player shells
- 16 held-only proposed player shells
- 182 ready relationship / identity occurrences
- 60 held relationship / identity occurrences
- 166 ready team dependencies
- 49 held team dependencies
- 0 ambiguous identity occurrences
- 0 missing team dependencies
- 0 existing Pelicans perspective holds

Pelicans-specific lineage invariants remain controlling:
- Bare "Hornets" is never a resolvable franchise identity.
- New Orleans Hornets / New Orleans-Oklahoma City Hornets remain in the
  New Orleans Pelicans lineage.
- Charlotte Bobcats / Charlotte Hornets remain a distinct Charlotte franchise.
- Seattle SuperSonics and Oklahoma City Thunder team records remain distinct.
- The frozen historical dependency correction for NOPNBA-2003-0002 resolves
  to Seattle SuperSonics.
- The four linked/rescinded structural rows remain excluded and produce no
  canonical, player, relationship, or team writes.

The Phase 21H importer is Pelicans-native and consumes the Phase 21F lower-camel
dependency schema directly. It does not rewrite Phase 21F evidence and does not
derive franchise identity from a bare historical nickname.

Only these six repository paths may change:
1. scripts/nba/import-new-orleans-pelicans-phase-21h-private-batch.mjs
2. scripts/nba/test-new-orleans-pelicans-phase-21h-private-batch.mjs
3. src/data/nba/new-orleans-pelicans-phase-21h-contract.md
4. src/data/nba/imports/new-orleans-pelicans-phase-21h-private-import.json
5. src/data/nba/players.json
6. src/data/nba/trades.json

teams.json must remain byte-identical.

All 19 held packages, all 60 held relationships/identities, all 16 held-only
player shells, and all four structural exclusions remain deferred. The 11 launch
Public Candidates remain private/noindex; this phase creates no public/index
authorization.

Shadow import, native semantic audit, relationship/query/route validation, and
idempotent replay must all PASS before any live repository write begins.
