# Cleveland Cavaliers Phase 8E Import Eligibility Freeze

## Purpose

Convert the Phase 8D routing freeze into a deterministic import-eligibility
partition and seed the next player/relationship-resolution phase.

## Frozen accounting

- Source rows: 204
- Eligible private packages: 150
- Held records: 44
- Linked administrative exclusions: 10
- Phase 8D packaging queue: 150
- Phase 8D remaining held rows: 54
- Frozen routes entering eligibility: 17
- Non-candidate routing rows remaining held: 7
- Recent provisional holds: 6
- Insufficient-evidence archival rows preserved: 6

## Eligibility policy

A record is eligible only when it:

- is packaging-ready after Phase 8D;
- is authorized for database import by the reviewed source;
- is not a recent provisional hold;
- is not a linked administrative row.

The 10 linked rows are classified as excluded rather than eligible or held.
The remaining 44 records stay held for reconciliation, identity, routing or
recent-outcome reasons.

## Dependency and identity seeding

Every eligible asset becomes a deterministic dependency seed. Clear player,
player-rights and named draft-outcome references become player identity seeds.
No fuzzy matching, player creation, identity merge or store write occurs.

## Safety

- Canonical imports: 0
- Player imports: 0
- Team-registry writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic merges: 0
- Automatic routes: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
