# Detroit Pistons Phase 11G Guarded Private Import Contract

Protocol: **Warp-Freeze Protocol**

Starting checkpoint: `d878329ef74577e99d96e0d0b1bbd7c3e4ff5414`

Phase 11G may import only the exact private partition frozen in Phase 11F:

- 258 ready packages
- 190 new canonical records
- 68 Detroit perspective appends
- 7 same-date records preserved as distinct canonical creates
- 20 linked or voided source rows excluded
- 240 frozen player-shell proposals
- 690 frozen player relationships

## Required behavior

1. The Phase 11F file hash and internal partition hash must match exactly.
2. `trades.json`, `players.json`, and `teams.json` must match the Denver-complete pre-import hashes.
3. Existing canonical records may receive one Detroit perspective only. Their protected identity, date, team and asset-ledger fields may not change.
4. New canonical records must use the frozen source assets and explicit multi-team routes. No date-only merge or automatic route is permitted.
5. All 20 linked/voided exclusions must remain absent as standalone canonical trades.
6. Exactly the 240 frozen player shells may be created. No inferred player creation or identity merge is permitted.
7. Exactly 690 relationship references must be added.
8. Every imported trade and player remains private, noindex, ad-free, sitemap-excluded and publication-ineligible.
9. The 52-team registry must remain byte-for-byte unchanged.
10. The importer must be idempotent: a second run performs zero repository data writes.

## Historical team routing alias

The frozen registry has no standalone `Indianapolis Jets` record. The three private 1948–1949 Jets transactions use the existing defunct `indianapolis-olympians` route solely as a registry alias. The original `Indianapolis Jets` source label remains preserved in the Detroit perspective and source fields. This alias does not assert franchise continuity and does not authorize public display.

## Prohibited actions

- Automatic canonical merges
- Automatic identity merges
- Player creation outside the frozen shell set
- Team-registry edits
- Publication, indexing or ad authorization
- Push or deployment
