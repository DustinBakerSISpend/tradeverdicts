# NBA Phase 2K first canonical-store import contract

Status: first private canonical write  
Batch: `wizards-pilot-001`

## Authorized write

Phase 2K may write exactly 27 repaired, schema-valid records from the Phase 2J structured preview into `src/data/nba/trades.json`.

The source preview must have SHA-256:

`A93364BAB5397ED6F86E1062C2D7B320D27FD1B05688AA9782FAA6C1C406E24A`

The canonical store must be the empty JSON array before this first import.

## Required safeguards

Every imported record remains:

- private;
- manual-review;
- noindex;
- ad-free;
- not publication-ready;
- ineligible for automatic merging.

The two exact Lakers/Wizards transactions remain single canonical records with two immutable source perspectives.

The eight multi-team records may retain explicit unresolved routing. The importer may not invent recipient teams.

## Prohibited actions

Phase 2K may not:

- write `players.json`;
- create NBA routes;
- run an Astro or production build;
- create a remote branch;
- push;
- create a preview deployment;
- deploy to production;
- enable advertising or indexing.

## Receipt

The import must create `src/data/nba/imports/wizards-pilot-001-phase-2k.json` with source and store hashes, all imported IDs, record counts, and the privacy result.
