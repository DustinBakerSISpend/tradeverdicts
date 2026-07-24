# Atlanta Hawks Phase 3D2D Contract

Phase 3D2D completes the private Atlanta source-batch pipeline from checkpoint:

`a436814ce16eb85209a5e6e36c2c9e3dbcb6e48d`

The immutable corrected freeze remains authorized only when its SHA-256 is:

`42AF200DAE6524919DED3CBDA62BDFE2238D3818F3119AD99B99499C5A404238`

## Authorized write

Phase 3D2D may update exactly one existing canonical trade:

`nba-trade-20260109-e1724a128785`

The update may only:

- add `atlanta-hawks` as one source team;
- add the reconciled Atlanta perspective from source row `ATL-2026-0300`;
- replace Atlanta's top-level canonical grade with the source-team grade `D+` while preserving Washington's `A-`;
- append the exact Atlanta source submission and official external reference;
- append one explicit Phase 3D2D perspective-reconciliation record;
- update the canonical record's `updatedAt` timestamp;
- create one private Phase 3D2D reconciliation receipt.

## Immutable fields

Phase 3D2D may not change:

- canonical trade count;
- canonical ID, slug, date, season, teams, canonical key, or date/team key;
- any received asset, sent asset, or asset-ledger record;
- routing status or unresolved-routing data;
- any player record;
- any player-trade relationship;
- any team-trade membership;
- the existing Washington perspective or source submission;
- the original Phase 2K import metadata;
- any held, duplicate, follow-up, conflict, or multi-team record.

No fuzzy match, semantic merge, automatic merge, automatic route, canonical creation, player creation, relationship write, or asset rewrite is authorized.

## Final Atlanta accounting

All 308 reviewed Atlanta source rows must be accounted for exactly once:

- 229 imported as new private two-team canonical trades;
- 1 reconciled into the existing Trae Young canonical;
- 15 retained as player-dependency holds;
- 54 retained as Phase 3C/manual holds;
- 4 retained as follow-up resolutions;
- 4 excluded as duplicate source variants;
- 1 retained as a source-conflict hold.

This is completion of the **private Atlanta batch pipeline**, not publication approval for held or imported content.

## Privacy and exposure

After reconciliation, all 256 canonical trades, 509 players, and 805 NBA route models must remain:

- private;
- noindex;
- ad-free;
- publication-ineligible;
- excluded from all sitemaps;
- unlinked from public pages.

The local build must remain 12,715 HTML pages with 11,910 public pages, 805 private NBA pages, 3,144 private NBA internal links, zero broken NBA links, zero public NBA links, and zero NBA sitemap URLs.

## Idempotence and recovery

The reconciliation must run twice with the same timestamp. The second run must produce zero changes and verify byte-identical canonical-store, player-store, and receipt content.

The phase may commit locally and create a verified recovery bundle. It may not push, create a preview deployment, or deploy to production.
