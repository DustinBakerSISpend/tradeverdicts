# NBA Phase 2M first private player-store import contract

Status: first private player write  
Batch: `wizards-pilot-001`

## Authorized write

Phase 2M may write exactly 67 source-derived player records from the approved Phase 2L player-candidate preview into `src/data/nba/players.json`.

The candidate preview must have SHA-256:

`9F05D2325E6450BCB772611FD1EFC2B85799FFD2C0DC016AEF34D6F3855B5B5C`

The player store must be the empty JSON array before this first import.

## Identity policy

A private player entity may be imported from:

- an exact player name carried by an audited canonical asset;
- an exact draft-rights player name;
- an exact realized draft-outcome player name;
- an explicitly approved source alias.

No fuzzy matching or external-ID merge is authorized.

External identity status remains `unverified`. This blocks publication but does not block a private source-derived entity record.

## Required safeguards

Every imported player remains:

- private;
- manual-review;
- noindex;
- ad-free;
- not publication-ready;
- ineligible for automatic merging.

All 90 source references must resolve back to the committed canonical trade and asset that produced them.

## Prohibited actions

Phase 2M may not:

- modify `trades.json`;
- create NBA routes;
- run an Astro or production build;
- create a remote branch;
- push;
- create a preview deployment;
- deploy to production;
- mark any external identity verified.

## Receipt

The import must create `src/data/nba/imports/wizards-pilot-001-players-phase-2m.json` with source and store hashes, all imported player IDs, reference counts, and the privacy result.
