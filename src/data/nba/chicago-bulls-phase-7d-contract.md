# Chicago Bulls Phase 7D Multi-Team Routing Freeze

## Purpose

Freeze the reviewed Chicago-facing routing for every multi-team source row
before canonical packaging. This phase resolves only the Bulls-facing asset
movement and preserves partner-only legs as context.

## Frozen source accounting

- Reviewed source rows: 219
- Phase 7C next-phase candidates: 177
- Phase 7C blocked or reconciliation rows: 42
- Administrative follow-ups: 7
- Multi-team routing transactions: 15
- Private archival grades: 15
- Research blockers: 0

## Routing policy

- Every multi-team transaction has a reviewed routing narrative.
- Every Bulls-facing incoming or outgoing asset has a frozen route edge.
- Partner-only legs are preserved as context and are not invented where the
  reviewed source does not provide a precise asset destination.
- A package advances after routing only when its sole Phase 7C blocker is
  `explicit-routing-required`.
- Records carrying identity, existing-canonical, prior-reviewed, or linked
  parent blockers remain held after routing.
- Insufficient-evidence rows remain database-ready private archives and are
  never reopened as research.

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
