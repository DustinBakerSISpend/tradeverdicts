# NBA Phase 2P private route-model readiness contract

Status: presentation-model preview only

## Purpose

Phase 2P converts the validated private query layer into deterministic route/view models without creating web routes.

The preview covers:

- one private NBA root model;
- three private section-index models;
- 27 canonical trade-detail models;
- 67 canonical player-detail models;
- 25 represented team-detail models.

## Link policy

Trade models link to represented teams and referenced players.

Player models link to their canonical trades.

Team models link to their canonical trades.

Section indexes link to canonical detail models. Approved player aliases remain search identities only and do not create duplicate routes.

Every modeled link must resolve to another modeled `/nba/` path.

## Privacy policy

Every model remains:

- private and local-only;
- manual-review;
- noindex and nofollow;
- ad-free;
- excluded from sitemap and navigation;
- not publication-ready;
- not authorized for route creation.

## Prohibited actions

Phase 2P may not modify either data store, create `src/pages/nba`, run Astro, build, push, or deploy.

Route files and a local build require a later separately guarded phase.
