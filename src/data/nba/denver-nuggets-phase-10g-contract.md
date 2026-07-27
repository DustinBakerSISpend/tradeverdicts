# Denver Nuggets Phase 10G Guarded Private Import Contract

## Scope

Phase 10G imports the hash-locked Phase 10F Denver partition into the private NBA stores.

## Authorized repository writes

1. `src/data/nba/trades.json`
2. `src/data/nba/players.json`
3. `src/data/nba/imports/denver-nuggets-phase-10g-private-import.json`
4. `scripts/nba/import-denver-nuggets-phase-10g-private-batch.mjs`
5. `scripts/nba/test-denver-nuggets-phase-10g-private-batch.mjs`
6. `src/data/nba/denver-nuggets-phase-10g-contract.md`

`src/data/nba/teams.json` must remain byte-for-byte unchanged.

## Frozen actions

- 180 new private canonical records
- 45 Denver perspective appends to exact existing canonicals
- 8 same-date transactions preserved as distinct canonical creates
- 6 linked or voided rows excluded from standalone import
- 234 new private player shells
- 632 private player relationship references
- 82 explicitly routed multi-team source assets on new canonical creates; 33 counterpart-matched source assets remain on protected existing ledgers
- 0 held-package imports
- 0 automatic canonical merges
- 0 automatic identity merges
- 0 automatic player creates outside the frozen shell set
- 0 publication, indexing, advertising, push, or deployment authorization

## Perspective append safety

An existing canonical trade may receive exactly one Denver perspective. Its protected ID, date, slug, team set, asset ledger, assets-by-team maps, source trade ID, and creation timestamp must not change.

## Explicit multi-team routing

All 23 multi-team transactions use the hash-locked Phase 10G explicit routing map. Every Denver-side source asset in those rows is assigned to a named counterpart team. Date-only matching, inferred cross-team merging, and unresolved automatic routing are prohibited.

## Identity safety

All 234 frozen shell proposals are new identities. The 311 exact-existing occurrences continue to target existing player records. Unknown compensation, player-to-be-named language, and non-identity draft mechanics create no player shell.

## Privacy

All created or updated records remain private, noindex, ad-free, and not publication-ready.

## Recovery

Any failed guard before checkpoint commit must restore the Phase 10F starting checkpoint and remove Phase 10G-created files.
