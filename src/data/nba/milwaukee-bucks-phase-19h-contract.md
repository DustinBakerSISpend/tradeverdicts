# Milwaukee Bucks Phase 19H Guarded Private Import Contract

Phase 19H imports only the frozen Phase 19F `IMPORT_READY` partition for the Milwaukee Bucks into the private NBA data layer.

Frozen source accounting:
- 201 source rows
- 163 import-ready packages
- 31 held packages
- 7 structural/evidence exclusions
- 92 existing-canonical Milwaukee perspective appends
- 71 new canonical creates
- 69 ready-required proposed player-shell candidates: 66 create new shells and 3 resolve to diagnostic-proven existing players
- 20 held-only proposed player shells
- 428 ready relationship previews
- 130 held relationship previews
- 326 ready team dependencies
- 89 held team dependencies
- 2 ambiguous identity occurrences, both held
- 0 existing-Milwaukee-perspective holds

Import rules:
- Only Phase 19F rows marked `IMPORT_READY` may write.
- All 15 routing-held packages remain held.
- All 10 recent-provisional packages remain held.
- Every dependency-held package remains held.
- No ambiguous identity occurrence may enter the ready write set.
- No existing Milwaukee perspective may be duplicated.
- `teams.json` is immutable in Phase 19H.
- Existing canonical trades may receive exactly one Milwaukee perspective; their protected canonical event projection must remain unchanged.
- New canonical trades are private, noindex, ad-free, and publication-ineligible.
- Exactly 66 ready-required proposed player shells must be absent from the frozen baseline before creation.
- Three diagnostic-proven exact identity collisions resolve to existing players and must not create duplicate shells:
  - `nba-player-d-j-augustin-62f0387e0b` -> `nba-player-dj-augustin-7b32f3fe01`
  - `nba-player-o-g-anunoby-2b0d93df9f` -> `nba-player-og-anunoby`
  - `nba-player-r-j-hampton-0a2d6dcc68` -> `nba-player-rj-hampton-62cbde2ae5`
- The 20 held-only player shells and 130 held relationship edges may not be written.
- Relationship references must resolve to a canonical asset or a deterministic perspective-local asset reference; no relationship may be dropped or multiply owned.
- Cross-player canonical source-reference ownership conflicts must fall back to deterministic perspective-local synthetic asset references rather than stealing an existing source-reference key.
- No automatic identity merge, canonical merge, team registration, routing edge creation, publication, push, or deployment is authorized.

Guarded wrapper write surface:
- `scripts/nba/import-milwaukee-bucks-phase-19h-private-batch.mjs`
- `scripts/nba/test-milwaukee-bucks-phase-19h-private-batch.mjs`
- `src/data/nba/milwaukee-bucks-phase-19h-contract.md`
- `src/data/nba/imports/milwaukee-bucks-phase-19h-private-import.json`
- `src/data/nba/players.json`
- `src/data/nba/trades.json`

The wrapper must first reproduce the import against shadow copies of the frozen stores, independently audit it with the frozen private relationship/query/route machinery, prove an idempotent replay, then reproduce the exact shadow hashes live before committing exactly the six authorized paths.

No push or deployment is authorized.
