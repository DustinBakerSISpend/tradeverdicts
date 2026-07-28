# Golden State Warriors Phase 12G Guarded Private Import Contract

Protocol: **Warp-Freeze Protocol**

Starting checkpoint: `d1e582a7a906a2f03acf06251703ae58499e72c1`

Phase 12G may import only the exact private partition frozen in Phase 12F:

- 199 ready packages
- 149 new canonical records
- 50 Golden State perspective appends
- 20 same-date records preserved as distinct canonical creates
- 16 held packages left untouched
- 6 linked or voided source rows excluded
- 164 ready-dependent player shells created
- 13 held-only player shells deferred
- 479 ready-package player relationships

## Required behavior

1. Every Phase 12D, 12E and 12F input hash must match exactly.
2. `trades.json`, `players.json`, and `teams.json` must match the Detroit-complete pre-import hashes.
3. Existing canonical records may receive one Golden State perspective only; protected identity, date, team, and asset-ledger fields may not change.
4. New canonical records must use only frozen two-team source assets. No date-only merge, automatic route, or team registration is permitted.
5. All 16 held packages and all six linked/voided exclusions must remain unimported.
6. Only the 164 frozen player shells needed by ready packages may be created. The 13 held-only shells must remain deferred.
7. Exactly 479 frozen relationship references must be added.
8. Every imported trade and player remains private, noindex, ad-free, sitemap-excluded, and publication-ineligible.
9. The 52-team registry must remain byte-for-byte unchanged.
10. The importer must be idempotent: a second run performs zero repository data writes.

## Prohibited actions

- Automatic canonical merges
- Automatic identity merges
- Player creation outside the ready-dependent frozen shell set
- Importing held or linked/voided packages
- Team-registry edits
- Publication, indexing, or ad authorization
- Push or deployment
