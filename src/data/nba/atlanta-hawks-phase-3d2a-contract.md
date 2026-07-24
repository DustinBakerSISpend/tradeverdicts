# NBA Phase 3D2A player-safety and scalable private-pilot contract

Status: infrastructure repair before player-store write
Starting checkpoint: `cde8bc6868d7ad04b29d0e431d8e2be520560bae`

## Purpose

Phase 3D2A removes two final classes of false player identities and replaces the private pilot's fixed 27-trade / 67-player assertions with data-driven invariants.

The audit found five non-player identity candidates in the Phase 3D1 freeze:

- `trade exception`;
- three right-of-first-refusal transaction descriptions involving Billy Paultz and Mike Glenn;
- one right-of-first-refusal transaction description involving Gus Williams.

Those values are transaction assets, not players changing teams. They must never enter `players.json`.

## Asset policy

- `trade exception`, `traded player exception`, and `TPE` parse as `trade_exception`;
- right-of-first-refusal consideration parses as `conditional_asset`;
- neither class emits a player identity or player-trade relationship;
- the identity layer independently quarantines both classes as defense in depth.

## Scalability policy

Private query, route-model, and exposure audits must derive expected counts from the committed stores. They may not assume 27 trades, 67 players, 123 NBA pages, or 434 links.

Dynamic validation still requires:

- unique canonical IDs, source IDs, player IDs, slugs, and exact identity keys;
- no invalid or duplicate player-reference ownership;
- bidirectional player/trade and team/trade links;
- every NBA model and built page private, noindex, ad-free, sitemap-excluded, and publicly unlinked;
- zero automatic player merges.

## Corrected freeze expectation

The corrected replay must produce:

- 229 two-team canonical creates;
- 15 player-dependency holds;
- 54 Phase 3C holds;
- 442 approved new-player identities;
- 7 approved existing-player uses;
- 690 frozen explicit asset routes;
- 556 frozen player-trade edges;
- 458 frozen team-trade edges;
- corrected freeze SHA-256 `42AF200DAE6524919DED3CBDA62BDFE2238D3818F3119AD99B99499C5A404238`.

## Prohibited actions

Phase 3D2A may not modify canonical, player, relationship, or route data stores. It may not push or deploy.
