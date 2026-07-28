# Los Angeles Clippers Phase 15H Guarded Private Import Contract

Phase 15H imports only the Phase 15F frozen IMPORT_READY partition for the Los Angeles Clippers into the private NBA data layer.

Locked source partition:
- 202 source rows
- 162 import-ready packages
- 20 held packages
- 20 structural/evidence exclusions
- 79 existing-canonical perspective appends
- 83 new canonical creates
- 82 ready-required player shells
- 14 held-only player shells
- 464 ready relationship previews
- 87 held relationship previews
- 40 Public Candidate packages, all imported privately only

Identity correction:
- Two 1977 Clippers relationship edges for George Johnson (Thomas) explicitly resolve to `nba-player-george-johnson-thomas-46726b5067`.
- The generic `nba-player-george-johnson-76fb1237b7` is not used for those two edges.
- This prevents duplicate ownership of the existing GSW 1977 canonical player reference.

Safety requirements:
- Held routing and recent/provisional packages are never imported.
- Structural/evidence exclusions are never imported.
- Held-only player shells are never created.
- Held relationship previews are never written.
- Existing canonical immutable trade identity and asset fields are not changed by perspective appends.
- No automatic canonical merge, identity merge, team registration, route creation, publication, index eligibility, or ad eligibility is authorized.
- `teams.json` is immutable in Phase 15H.
- Every imported trade/player remains private, noindex, ad-free, sitemap-excluded, and navigation-excluded.
- Public Candidate is editorial classification only and does not authorize publication.
- Phase 15H writes only `trades.json`, `players.json`, the private-import receipt, importer/tester source, and this contract when run through the guarded wrapper.
- No push or deployment is authorized.