# Charlotte Hornets Phase 6D Multi-Team Routing Contract

## Frozen inputs

- Starting checkpoint: `74b9d1d2c5b76f29a288a95bf27be028d71043f5`
- Phase 6C decision-record SHA-256: `BF2799CD8A1C17FFB62721E3CAACDA333DC249BF2A03CE66EEF142C96D5D1714`
- Phase 6B preview-record SHA-256: `051D4DA8A0D2673A5F487EF33572A7C2FCE933D2EA00AF085DF056FFC47F29C4`
- Source team: `charlotte-hornets`
- Routing-required transactions: `10`

## Routing objective

Phase 6D resolves the Charlotte-side asset origin and destination for every
multi-team routing hold. Supplemental partner-to-partner edges preserve enough
transaction context to prevent source assets from being assigned to the wrong
counterpart.

A route may remove only the blocker `explicit-routing-required`. All other
Phase 6C blockers remain intact. A routed row advances to the packaging queue
only when it is a new-canonical candidate and its only remaining gate is
`canonical-create-approval-required`.

## Required outputs

1. Routing freeze JSON
2. Route-edge CSV
3. Transaction summary CSV
4. Corrections CSV
5. Supplemental-context CSV
6. Cross-team-routing CSV
7. Packaging queue CSV
8. Remaining-holds CSV
9. Summary JSON

## Safety

- Canonical imports: 0
- Player imports: 0
- Team-registry writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
