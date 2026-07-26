# Chicago Bulls Phase 7E v2 Import Eligibility Freeze

## Purpose

Freeze the exact set of Chicago Bulls records that may proceed to private
canonical packaging after Phase 7D, while preserving reconciliation holds and
linked administrative exclusions.

## Fixed accounting

- Source rows: 219
- Eligible private canonical packages: 187
- Held reconciliation or identity records: 25
- Linked follow-up exclusions: 7
- Total private archive grades preserved as database-ready: 15
- Research blockers: 0

## Corrected archive-readiness contract

Archive readiness and immediate package eligibility are separate states.

The 15 insufficient-evidence records must all remain database-ready private
archives, but an archive record may legitimately be inside either the eligible
queue or the reconciliation-hold queue. Therefore:

- archive eligible + archive held + archive excluded = 15
- no insufficient-evidence record may return to Needs Research
- no insufficient-evidence record may lose private/noindex status
- no held archive record is treated as public or discarded

## Dependency seed

Every incoming and outgoing asset from an eligible package receives a stable
dependency seed key. Player and player-rights assets are separately marked for
the identity-resolution phase. Draft assets, cash, trade exceptions and other
consideration remain in the complete asset dependency seed.

## Eligibility rules

A record is eligible only when:

- Phase 7D marked it packaging-ready.
- No blocker remains after routing.
- It is not a linked merge/exclude row.
- The reviewed dataset authorizes database import.
- No research or hold-publication status remains.

## Safety

- Canonical imports: 0
- Player imports: 0
- Team-registry writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic canonical merges: 0
- Automatic identity merges: 0
- Automatic routes: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
