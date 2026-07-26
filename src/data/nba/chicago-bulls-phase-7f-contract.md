# Chicago Bulls Phase 7F Player Identity and Relationship Freeze

## Purpose

Resolve the player-facing dependency seeds from the 187 Phase 7E eligible
packages against the unchanged private player registry, then freeze proposed
player shells and relationship previews without writing either store.

## Fixed input accounting

- Source rows: 219
- Eligible input packages: 187
- Existing held records: 25
- Linked exclusions: 7
- Dependency seeds: 620
- Player-identity seeds: 371
- Non-identity asset seeds: 249
- Archive-ready input rows: 15
- Archive-eligible input rows: 13
- Archive-held input rows: 2
- Archive-excluded input rows: 0
- Existing private players: 1,292

## Identity policy

- Exact normalized identity matching is allowed only when exactly one existing
  player record owns the identity key.
- More than one exact owner is ambiguous and holds the full package.
- Safe unmatched names may produce deterministic proposed player shells.
- Unsafe or non-name identity text holds the full package.
- No fuzzy match can merge an identity automatically.
- A held package produces no relationship preview, even when some of its
  individual occurrences were otherwise resolvable.

## Relationship policy

- Every resolved player occurrence in a ready package receives one frozen
  relationship preview.
- Incoming assets are classified as Chicago-acquired-player edges.
- Outgoing assets are classified as Chicago-sent-player edges.
- Relationship previews remain private, noindex, ad-free and unwritten.

## Safety

- Canonical imports: 0
- Player imports: 0
- Team-registry writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic player creates: 0
- Automatic identity merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
