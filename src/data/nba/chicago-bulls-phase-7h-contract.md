# Chicago Bulls Phase 7H Guarded Private Import

## Purpose

Import only the final Phase 7G ready partition into the private NBA stores.

## Frozen import set

- Canonical trades created: 173
- Player shells created: 218
- Relationship references added: 349
- Identity-held packages untouched: 14
- Prior reconciliation or canonical holds untouched: 25
- Linked follow-up exclusions untouched: 7
- Total untouched source rows: 46

## Import policy

- Every imported trade is a new private canonical record.
- No existing canonical perspective is appended.
- Existing players are reused only through the exact frozen Phase 7G target ID.
- New player IDs come directly from the frozen proposed-player-shell set.
- Every relationship preview is attached to exactly one canonical asset and
  one existing or newly created player.
- Multi-team records use only the reviewed Bulls-facing route edges frozen in
  Phase 7D; partner-only legs remain contextual notes.
- Missing historical team slugs may be registered deterministically from the
  frozen lineage file.
- Every imported trade and player remains private, noindex, ad-free and
  publication-ineligible.

## Safety

- Automatic identity merges: 0
- Automatic canonical merges: 0
- Automatic routes: 0
- Held-package imports: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
