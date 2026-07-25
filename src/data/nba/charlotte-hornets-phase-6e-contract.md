# Charlotte Hornets Phase 6E Import-Eligibility Freeze

## Frozen inputs

- Starting checkpoint: `2d691916d971c65ccdf932e4852362d028846d5b`
- Phase 6C decision-record SHA-256: `BF2799CD8A1C17FFB62721E3CAACDA333DC249BF2A03CE66EEF142C96D5D1714`
- Phase 6D freeze-record SHA-256: `D5771562A529007ACC6F4B1B81E90FEC680D7F0A31CCF7B4D24D712B376C115D`
- Phase 6D route-edge SHA-256: `5729D17D4F3159DDA1685B4276447D3544C17651EB84E9B6966B26BE0B60B5C5`

## Frozen accounting

- Reviewed source rows: 125
- Import-package eligible rows: 103
- Held rows: 20
- Non-standalone follow-ups: 2

## Eligibility rule

A row is eligible only when Phase 6D marks `packagingEligible: true`.
Eligible rows must be new-canonical candidates whose sole remaining blocker is
`canonical-create-approval-required`.

Phase 6E freezes eligibility; it does not authorize canonical creation.

## Dependency seed

For each eligible record, Phase 6E emits the reviewed incoming and outgoing
asset strings as a dependency seed. The dependency classification is
conservative and does not create or resolve player IDs.

## Safety

- Canonical imports: 0
- Player imports: 0
- Team-registry writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Canonical IDs assigned: 0
- Automatic merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
