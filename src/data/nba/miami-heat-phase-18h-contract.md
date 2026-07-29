# Miami Heat Phase 18H Guarded Private Import Contract

Phase 18H imports only the frozen Phase 18F `IMPORT_READY` partition for the continuous Miami Heat franchise into the private NBA data layer.

Frozen source accounting:
- 98 source rows
- 75 import-ready packages
- 12 held packages
- 11 structural/evidence exclusions
- 38 existing-canonical Miami perspective appends
- 37 new canonical creates
- 29 ready-required proposed player shells
- exactly 1 ready shell (`nba-player-a-j-hammons`) is diagnostically resolved to existing player `nba-player-aj-hammons-10e57ab027`
- 28 new player shells are therefore expected to be created
- 6 held-only proposed player shells
- 204 ready relationship previews
- 58 held relationship previews
- 149 ready team dependencies
- 37 held team dependencies
- 2 ambiguous identity occurrences, both held

Import rules:
- Only Phase 18F rows marked `IMPORT_READY` may write.
- All 10 routing-held packages remain held.
- Both dependency-held packages remain held.
- No ambiguous identity occurrence may enter the ready write set.
- No existing Miami perspective may be duplicated.
- `teams.json` is immutable in Phase 18H.
- Existing canonical trades may receive exactly one Miami perspective; their protected canonical event projection must remain unchanged.
- New canonical trades are private, noindex, ad-free, and publication-ineligible.
- Ready proposed player shells may be created only when their frozen player ID does not already exist.
- The only existing-player override authorized is `nba-player-a-j-hammons` -> `nba-player-aj-hammons-10e57ab027`, and only because the frozen read-only identity diagnostic proved one baseline/one-new exact-identity equivalence with zero unresolved ambiguity groups.
- Held-only player shells and held relationship edges may not be written.
- Relationship references must resolve to a canonical asset or a deterministic perspective-local asset reference; no relationship may be dropped or multiply owned.
- No automatic identity merge, canonical merge, team registration, routing edge creation, publication, push, or deployment is authorized.

Guarded wrapper write surface:
- `scripts/nba/import-miami-heat-phase-18h-private-batch.mjs`
- `scripts/nba/test-miami-heat-phase-18h-private-batch.mjs`
- `src/data/nba/miami-heat-phase-18h-contract.md`
- `src/data/nba/imports/miami-heat-phase-18h-private-import.json`
- `src/data/nba/players.json`
- `src/data/nba/trades.json`

The wrapper must first reproduce the import in a shadow repository, independently audit it, prove an idempotent replay, then reproduce the exact shadow hashes live before committing exactly the six authorized paths.

No push or deployment is authorized.
