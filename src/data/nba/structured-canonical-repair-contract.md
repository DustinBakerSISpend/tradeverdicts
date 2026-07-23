# NBA structured canonical repair contract

Status: Phase 2J dry-run repair  
Scope: Wizards pilot structured canonical records  
Canonical imports: prohibited in this phase

## Import blockers discovered after Phase 2I

Phase 2I passed the canonical schema, but the record-level import audit found two semantic normalization defects:

1. Six source pick-swap contracts had collapsed into two structured `pick_swap` assets. The four Phoenix swap years were represented as one aggregate asset, and the 2032 Memphis/Washington swap was classified as a draft pick.
2. Draft-rights pick numbers and the `waived` transaction note were embedded inside player identity fields.

A schema-valid record is not automatically import-safe. Phase 2J repairs these semantic defects before any canonical-store write.

## Required repairs

- Preserve six distinct pick-swap contract objects:
  - Washington/Milwaukee: 2028 first
  - Washington/Phoenix: 2024, 2026, 2028 and 2030 firsts
  - Memphis/Washington: 2032 second
- Preserve contract holder, subject, round, year, exercise status and immutable source representations.
- Store draft-rights player names without `(#N)` suffixes.
- Store draft overall separately when supplied.
- Assign the draft year from the audited transaction year for these draft-night rights transactions.
- Store `Reggie Jackson` as the player identity and `waived` as transaction context.

## Safety boundary

This phase produces a repaired external preview only. It does not populate `trades.json`, alter `players.json`, create routes, build Astro, merge automatically, push, or deploy.
