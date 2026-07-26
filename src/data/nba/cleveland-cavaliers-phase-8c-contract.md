# Cleveland Cavaliers Phase 8C Canonical Decision Matrix

## Purpose

Convert the exact Phase 8B canonical preview into explicit resolution classes
and deterministic next-action queues. Unresolved cross-team declarations are
split between rows already blocked by Phase 8B routing and newly added Phase
8C declaration holds.

## Frozen source accounting

- Source rows: 204
- Standalone rows: 194
- Linked administrative rows: 10
- Directional rows: 188
- Public candidates: 77
- Private/noindex rows: 117
- Insufficient-evidence archival rows: 6
- Routing-required rows: 24
- Current-store matched source rows: 37
- Prior-reviewed exact-match rows: 31
- Within-Cavaliers collision rows: 2
- Recent provisional holds: 6
- Phase 8B blocker rows: 70
- Direct packaging candidates: 134
- Blocked or reconciliation rows: 70

## Decision policy

Resolution precedence is:

1. linked administrative follow-up;
2. recent provisional hold;
3. ambiguous current canonical;
4. exact current canonical reconciliation;
5. within-Cavaliers collision;
6. multiple prior-reviewed matches;
7. one prior-reviewed exact match;
8. declared prior-reviewed match without exact identity;
9. explicit multi-team routing candidate;
10. new canonical candidate.

Only clean new-canonical candidates enter the direct packaging queue.
Routing candidates remain frozen for Phase 8D. Reconciliation, identity,
recent-provisional and linked rows remain held. A declaration may already be
inside the Phase 8B blocker set when the same row also requires routing; that
overlap is counted separately rather than treated as drift.

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
