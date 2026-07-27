# Cleveland Cavaliers Phase 8H Private Import Contract

## Scope

Import exactly the 150 zero-blocker Cleveland packages frozen by Phase 8G into the private NBA canonical stores.

## Authorized repository data writes

- `src/data/nba/trades.json`
- `src/data/nba/players.json`
- `src/data/nba/teams.json` only when a frozen team dependency is absent
- `src/data/nba/imports/cleveland-cavaliers-phase-8h-private-import.json`

## Frozen outcomes

- Create exactly 150 private canonical trade records.
- Create exactly 238 private player shells.
- Add exactly 446 frozen player-to-trade relationship references.
- Preserve all 44 prior-held and 10 excluded source records without importing them.
- Perform no automatic canonical merges, identity merges, or inferred routes.
- Keep every imported trade and player private, noindex, ad-free, and publication-ineligible.
- Preserve the reviewed Cleveland perspective and explicit reviewed routing for multi-team records.

## Guards

- Require branch `nba-import`, exact Phase 8G checkpoint, and a clean worktree.
- Verify every Phase 8G frozen hash and every canonical-store preimage.
- Reject canonical IDs, player IDs, relationship IDs, or asset targets that collide or drift.
- Require deterministic output and an idempotent replay.
- Require private query, relationship graph, route-model, exposure, link, and production-build checks.
- On any failure, restore the Phase 8G checkpoint and remove only Phase 8H-created untracked files.

## Publication and delivery

Publication is not authorized. No push, preview deployment, or production deployment is permitted in Phase 8H.
