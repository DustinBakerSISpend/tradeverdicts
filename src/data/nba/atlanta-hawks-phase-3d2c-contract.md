# NBA Phase 3D2C frozen Atlanta canonical and relationship import contract

Status: guarded private canonical-store write

## Authorization

Phase 3D2C may execute only from checkpoint:

`444ee18bc383244cabf645f2920d598fd9d61d14`

The corrected immutable Atlanta freeze must regenerate byte-identically with SHA-256:

`42AF200DAE6524919DED3CBDA62BDFE2238D3818F3119AD99B99499C5A404238`

Because Phase 3D2B already added 442 private player shells, the historical 67-player baseline must be reconstructed from the guarded 509-player store and verified against:

`44A398089E496542851D103A2DE01B74E80776F46B80251F76DA4C97014B19C1`

## Authorized writes

Phase 3D2C may:

- append exactly 229 frozen two-team canonical trades;
- write exactly 690 frozen routed assets;
- activate exactly 556 frozen player-trade references;
- activate the 458 team-trade memberships inherent in those canonical trades;
- update the 442 Phase 3D2B shells from pending relationship status to active private relationships;
- append frozen Atlanta references to exactly seven reused existing player identities;
- create one private Phase 3D2C import receipt.

The post-import stores must contain:

- 256 canonical trades;
- 509 players;
- 646 active player-trade references in the full private graph;
- 524 team-trade memberships in the full private graph;
- 36 represented teams.

## Canonical rules

Every imported trade must use the exact frozen:

- canonical trade ID;
- source trade ID;
- transaction fingerprint;
- canonical key;
- date/team key;
- source-perspective key;
- asset IDs;
- explicit two-team asset routes;
- per-record freeze hash.

No multi-team, conflict, follow-up, duplicate, unresolved-player, dependency-held, or Phase 3C-held row may be imported.

No fuzzy match, semantic merge, inferred route, or automatic merge is authorized.

## Relationship rules

Player relationships must be activated only from the 556 frozen player-trade edges. Each relationship must retain its edge ID and edge freeze SHA-256.

All Phase 3D2B pending references must be cleared only after their matching canonical trade is written. Existing-player references must be appended without altering prior references.

The import and replay must leave zero missing, extra, invalid, or duplicate player-reference ownership records in the private relationship graph.

## Trae Young exclusion

The existing canonical trade:

`nba-trade-20260109-e1724a128785`

must remain unchanged in Phase 3D2C. The Atlanta perspective is reserved for a later perspective-only reconciliation phase. Phase 3D2C must not add an Atlanta perspective, change the source teams, or rewrite the existing import metadata.

## Privacy

Every imported trade and every updated player remains:

- private;
- noindex;
- ad-free;
- publication-ineligible;
- sitemap-excluded;
- publicly unlinked.

## Idempotence

The importer must run twice with the same timestamp and starting checkpoint. The second run must produce zero changes and verify byte-identical trade-store, player-store, and receipt content.

## Prohibited actions

Phase 3D2C may not:

- reconcile the Atlanta Trae Young perspective;
- import held or non-standalone records;
- create or infer multi-team routes;
- create public/indexable/ad-supported NBA content;
- push;
- create a preview deployment;
- deploy to production.
