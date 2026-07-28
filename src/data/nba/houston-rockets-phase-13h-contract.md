# Houston Rockets Phase 13H Private Import Contract

## Purpose

Phase 13H is the first write-authorized Houston Rockets phase. It imports only the exact Phase 13F ready trade partition into the private NBA data stores and preserves every held or structural/evidence row outside the live Houston import.

## Frozen source scope

- Source rows: 231
- Import-ready packages: 191
- Held packages: 26
- Structural/evidence exclusions: 14
- Existing-canonical perspective appends: 59
- New canonical creates: 132
- Frozen ready-required player-shell proposals: 136
- Frozen held-only player shells: 22
- Frozen ready relationship edges: 546
- Frozen held relationship edges: 118
- Public Candidate records inside the ready set: 44

## Phase 13H shadow-import identity corrections

The support-capture shadow import found three exact identity/reference conflicts that would violate the existing private-query invariants. Phase 13H freezes the following narrow corrections before the live write:

1. `nba-player-d-j-augustin` is not created. The Houston D.J. Augustin relationship resolves to existing `nba-player-dj-augustin-7b32f3fe01`.
2. The Houston 1976 Dwight Jones relationship resolves to existing source-reference owner `nba-player-dwight-jones-elmo-8cc879edc8` instead of `nba-player-dwight-jones`.
3. Phrase-derived `nba-player-veteran-free-agent-lester-conner` is excluded as a redundant pseudo-identity. Its duplicate relationship edge is excluded; the same asset retains the independently frozen existing Lester Conner relationship to `nba-player-lester-conner-bbd3d89a7d`.

Therefore the live Phase 13H dependency write scope is:

- New player shells created: 134
- Ready shell proposals resolved to existing players: 1
- Redundant ready shell proposals excluded: 1
- Relationship references written: 545
- Redundant ready relationship edges excluded: 1
- Held-only player shells deferred: 22
- Held relationship edges deferred: 118

The 191-package trade partition is unchanged by these identity corrections.

## Authorized live write surface

Exactly six repository files may change in Phase 13H:

1. `scripts/nba/import-houston-rockets-phase-13h-private-batch.mjs`
2. `scripts/nba/test-houston-rockets-phase-13h-private-batch.mjs`
3. `src/data/nba/houston-rockets-phase-13h-contract.md`
4. `src/data/nba/imports/houston-rockets-phase-13h-private-import.json`
5. `src/data/nba/trades.json`
6. `src/data/nba/players.json`

`src/data/nba/teams.json` is read-only and must remain byte-identical.

## Import controls

- Only Phase 13F `IMPORT_READY` packages may be imported.
- All 23 routing holds and all 3 recent/provisional holds remain unimported.
- All 14 structural/evidence exclusions remain unimported.
- No held-only player shell may be created.
- No held relationship edge may be written.
- Existing canonical trades may receive one Houston perspective only; protected canonical identity, routing and asset fields must not change.
- New Houston canonical IDs use the deterministic `nba-trade-hou-YYYY-NNNN` namespace.
- No automatic canonical merge, player identity merge, team registration or routing decision is authorized.

## Privacy contract

Every imported Houston trade and player remains private, noindex, ad-free and not publication-ready. The 44 Public Candidate packages are imported privately only; Phase 13H does not authorize their publication.

## Repository controls

- Starting branch: `nba-import`
- Starting HEAD: `354a62cc36f70ec8b4242d974e747f73e659a836`
- Push: not authorized
- Deployment: not authorized
- Phase 13I remains required for final post-import verification and Houston completion freeze.
