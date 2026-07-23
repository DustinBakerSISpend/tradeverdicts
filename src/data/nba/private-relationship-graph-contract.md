# NBA Phase 2N private relationship-graph preview contract

Status: read-only integrity phase

## Purpose

Phase 2N proves that the committed Phase 2K trade store and Phase 2M player store can be reprocessed without duplicates or changes.

It also builds an external relationship-graph preview for future private query and route work.

## Required results

- 27 canonical trades remain exact and unchanged.
- 67 player records remain exact and unchanged.
- Player-store reprocessing produces zero inserts, updates, or conflicts.
- All 90 player references resolve to one canonical trade asset.
- No canonical player reference is missing or owned by multiple player records.
- All trade team slugs exist in the NBA team registry.
- No trade or player record is orphaned.

## Graph scope

The graph contains:

- 25 represented team nodes;
- 27 trade nodes;
- 67 player nodes;
- 66 team-to-trade membership edges;
- 90 player-to-trade reference edges.

No player-to-team edge is inferred from a multi-team transaction. Team membership and player reference edges remain separate.

## Visibility and safety

All trade and player records remain private, manual-review, noindex, ad-free, and publication-ineligible.

Phase 2N may create external preview JSON and CSV files only. It may not modify either store, create routes, run Astro, push, or deploy.
