# Atlanta Hawks Phase 3D1 Contract

Phase 3D1 creates an immutable, duplicate-safe import-eligibility manifest. It performs no canonical, player, relationship, or route writes.

## Hard prohibitions

- No canonical trade import.
- No player import.
- No relationship import.
- No route creation.
- No automatic trade merge.
- No automatic player merge.
- No inferred multi-team routing.
- No push, preview deploy, or production deploy.

## Freeze rules

1. Regenerate Phase 3B and Phase 3C from the committed reviewed Atlanta batch and current stores.
2. Freeze canonical IDs, date/team keys, transaction fingerprints, source-perspective keys, asset IDs, player IDs, player slugs, and relationship IDs.
3. Require byte-identical output from two independent manifest generations.
4. Reject duplicate canonical IDs, source-perspective keys, executable fingerprints, player IDs, player slugs, relationship IDs, or asset-route keys.
5. Reject any new canonical ID that already exists in the canonical store.
6. Preserve the Trae Young record only as a pending Atlanta perspective reconciliation against `nba-trade-20260109-e1724a128785`.
7. Keep all Phase 3C holds, multi-team routes, parser-placeholder records, duplicate variants, follow-up rows, and source conflicts out of the executable set.
8. Add a second player-dependency gate: a trade is not executable when any referenced new player identity is not itself import-ready.
9. Freeze only explicit two-team routes; automatic routing remains prohibited.
10. Keep every manifest entry private, noindex, ad-free, and publication-blocked.

The Phase 3D2 import may consume only the exact `create-canonical`, `create-new-player`, `use-existing-player`, and frozen relationship/route records whose hashes match this checkpoint.
