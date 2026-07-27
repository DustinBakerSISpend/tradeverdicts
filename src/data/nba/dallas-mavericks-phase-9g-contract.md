# Dallas Mavericks Phase 9G Guarded Private Import Contract

## Scope

Phase 9G imports the hash-locked Phase 9F Dallas partition into private NBA stores.

## Authorized repository writes

1. `src/data/nba/trades.json`
2. `src/data/nba/players.json`
3. `src/data/nba/imports/dallas-mavericks-phase-9g-private-import.json`
4. `scripts/nba/import-dallas-mavericks-phase-9g-private-batch.mjs`
5. `scripts/nba/test-dallas-mavericks-phase-9g-private-batch.mjs`
6. `src/data/nba/dallas-mavericks-phase-9g-contract.md`

`src/data/nba/teams.json` must remain byte-for-byte unchanged.

## Frozen actions

- 115 new private canonical records
- 36 Dallas perspective appends to exact existing canonicals
- 4 same-date transactions preserved as distinct canonical creates
- 4 parent-linked rows excluded from standalone import
- 182 new private player shells plus 1 frozen proposal resolved to an existing player
- 507 private player relationship references
- 0 held-package imports
- 0 automatic canonical merges
- 0 automatic identity merges
- 0 automatic player creates outside the frozen shell set
- 0 publication, indexing, advertising, push, or deployment authorization

## Perspective append safety

An existing canonical trade may receive exactly one Dallas perspective. Its protected ID, date, slug, team set, asset ledger, assets-by-team maps, source trade ID, and creation timestamp must not change.


## Explicit identity correction

The single malformed frozen shell `nba-player-vsevolod-ishchenko-via-los-angeles-and-chicago-69c7c91a9c` must not be imported. Phase 9G resolves it to the existing player `nba-player-vsevolod-ishchenko` with display name `Vsevolod Ishchenko`. The frozen relationship edge key is retained for lineage, but its player target is redirected to the existing player. This produces 182 new shells from 183 frozen proposals. No other shell or relationship target may change.

## Privacy

All created or updated records remain private, noindex, ad-free, and not publication-ready.

## Recovery

Any failed guard before checkpoint commit must restore the Phase 9F starting checkpoint and remove Phase 9G-created files.
