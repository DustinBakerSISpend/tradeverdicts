# NBA structured canonical preview contract

Status: Phase 2I dry-run contract  
Scope: Wizards pilot, with linked Lakers source perspectives  
Canonical imports: prohibited in this phase

## Why this phase exists

The Phase 2H candidate preview proved dates, teams, duplicate linkage, audit status, privacy defaults, and provenance. It intentionally carried audited assets as display strings and did not include an explicit canonical verdict field.

The approved NBA foundation requires:

- structured asset objects;
- an explicit canonical verdict;
- canonical grades and perspectives;
- immutable source provenance;
- private, noindex, ad-free defaults.

Phase 2I assembles and validates those fields without writing `trades.json`.

## Asset-routing policy

Two-team transactions are fully routed from the audited Washington perspective:

- assets Washington received are keyed to Washington;
- assets Washington sent are keyed to the partner.

Multi-team transactions remain partial unless the audited source resolves every final recipient:

- Washington's received and sent assets are structured;
- uncertain outbound recipients are stored in `unresolvedAssetRouting`;
- empty partner arrays do not imply that those teams received nothing;
- the importer must not invent recipient teams.

## Perspective policy

Each record retains the Wizards source perspective. The Rui Hachimura and Deandre Ayton records also link the exact Lakers source perspectives.

A linked Lakers source record does not inherit Washington's editorial grade. Lakers editorial fields remain pending until separately audited.

## Visibility and import boundary

Every preview record must remain:

- `publishStatus: private`
- `reviewStatus: manual-review`
- `indexEligible: false`
- `adEligible: false`
- `publicationReady: false`

This phase may create external preview JSON and CSV files only. It may not populate canonical stores, create routes, build Astro, push, or deploy.
