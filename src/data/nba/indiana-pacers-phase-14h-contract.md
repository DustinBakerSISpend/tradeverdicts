# Indiana Pacers Phase 14H Guarded Private Import Contract

Phase 14H imports only the Phase 14F frozen IMPORT_READY partition for the Indiana Pacers into the private NBA data layer.

Locked source partition:
- 168 source rows
- 133 import-ready packages
- 16 held packages
- 19 structural/evidence exclusions
- 50 existing-canonical perspective appends
- 83 new canonical creates
- 85 ready-required player shells
- 13 held-only player shells
- 346 ready relationship previews
- 57 held relationship previews
- 31 Public Candidate packages, all imported privately only

Safety requirements:
- Held routing and recent/provisional packages are never imported.
- Structural/evidence exclusions are never imported.
- Held-only player shells are never created.
- Held relationship previews are never written.
- Existing canonical immutable trade identity and asset fields are not changed by perspective appends.
- No automatic canonical merge, identity merge, team registration, route creation, publication, index eligibility, or ad eligibility is authorized.
- teams.json is immutable in Phase 14H.
- Every imported trade/player remains private, noindex, ad-free, sitemap-excluded, and navigation-excluded.
- Public Candidate is editorial classification only and does not authorize publication.
- Phase 14H writes only trades.json, players.json, the private-import receipt, importer/tester source, and this contract when run through the guarded wrapper.
- No push or deployment is authorized.
