# Atlanta Hawks Phase 3B — Duplicate-Safe Canonical Preview Contract

Phase 3B is a preview-only checkpoint. It converts the reviewed Atlanta source perspective into deterministic canonical candidate identities without importing canonical trades, players, relationships, or routes.

## Duplicate protections

1. Every standalone source row receives a deterministic `sourcePerspectiveKey`, `transactionFingerprint`, `dateTeamsKey`, provisional canonical key, and provisional canonical ID.
2. Existing canonical trades are compared by resolved franchise team set, exact or near trade date, and semantic typed-asset similarity.
3. An explicit existing canonical match must survive independent date, team, and semantic checks.
4. Exact-date/team collisions are not automatically merged. They are separated into semantic matches or distinct same-day transactions.
5. Date variants within three days require high semantic overlap and always remain manual-review holds.
6. Duplicate provisional canonical IDs and duplicate source-perspective keys are fatal errors.
7. Follow-up deliveries, duplicate source variants, and source conflicts remain non-standalone records.
8. Automatic merges are prohibited.

## Expected Atlanta result

- 308 reviewed source rows
- 299 standalone perspective rows
- 298 clear new canonical previews
- 1 existing perspective match (`nba-trade-20260109-e1724a128785`)
- 9 non-standalone rows
- 277 canonical-data-ready previews
- 22 blocked previews requiring evidence, routing, parser, or source resolution
- 2 legitimate same-date/team transaction pairs preserved as distinct
- 0 unannounced existing-canonical duplicate risks
- 0 automatic merges
- 0 canonical imports
- 0 player imports
- 0 routes
- 0 push or deployment

All records remain private, noindex, ad-free, and publication-blocked.
