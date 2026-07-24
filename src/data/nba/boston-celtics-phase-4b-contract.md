# Boston Celtics Phase 4B — Duplicate-Safe Canonical Preview Contract

## Starting checkpoint

`8c7feba2bd5c953dac928b9b91b170893bde9992`

## Purpose

Phase 4B converts the 223 reconciled Boston source rows into deterministic
canonical identity previews while preventing duplicate transactions across:

- the existing 256-trade canonical store;
- the completed Atlanta reviewed batch;
- the Boston source batch itself.

## Required source accounting

- 223 reviewed Boston rows
- 211 standalone preview rows
- 12 non-standalone rows
- 14 Atlanta-lineage overlap flags
- 13 exact Atlanta date/team reviewed overlaps
- 1 unmatched Atlanta-lineage row: `BOS-1949-0016`

## Action rules

1. A unique semantic match in the current canonical store becomes a preview
   recommendation to append Boston's source perspective.
2. A reviewed Atlanta overlap that is not yet canonical remains held for one
   shared future canonical identity.
3. Same-day collisions, near-date variants, ambiguous matches and within-Boston
   duplicate risks remain held.
4. Evidence, routing, parser and recent-outcome holds remain held.
5. Only rows with no existing or cross-team match, no duplicate risk, no
   unresolved routing and no unclassified assets may become clear new-canonical
   previews.
6. No action in this phase writes a canonical trade or merges perspectives.

## Safety

- Canonical imports: 0
- Player imports: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic merges: 0
- Public pages: 0
- Push: no
- Preview deployment: no
- Production deployment: no

All generated previews remain external backup artifacts. Only the reusable
builder, test and this contract are committed locally.
