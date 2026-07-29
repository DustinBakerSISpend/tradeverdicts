# Memphis Grizzlies Phase 17H Guarded Private Import Contract

Phase 17H imports only the frozen Phase 17F `IMPORT_READY` partition for the continuous Vancouver/Memphis Grizzlies franchise into the private NBA data layer.

Locked source partition:
- 126 source rows
- 93 import-ready packages
- 21 held packages
- 12 structural/evidence exclusions
- 40 existing-canonical Memphis perspective appends
- 53 new canonical creates
- 59 ready-required player shells
- 17 held-only player shells
- 281 ready relationship previews
- 101 held relationship previews
- 186 ready team dependencies
- 69 held team dependencies
- 39 Public Candidate packages, all imported privately only

Memphis-specific holds:
- All 21 routing-required packages remain held; aggregate Memphis packages do not authorize partner-edge imports.
- All 12 structural/evidence exclusions remain excluded from standalone import.
- No ambiguous identity occurrence exists in the frozen partition.
- No existing Memphis perspective exists on any append target; duplicate appends remain prohibited.

Identity and reference controls:
- The frozen identity/dependency pass resolved 287 existing identity occurrences and proposed 76 unique shells, of which 59 are required by ready packages and 17 are held-only.
- Michael Smith (Providence) remains isolated from John Michael Smith.
- Relationship references that cannot map uniquely to an existing shared-canonical asset use deterministic perspective-local synthetic asset references without changing protected canonical asset fields.

Safety requirements:
- Held packages and structural/evidence exclusions are never imported.
- Held-only player shells are never created.
- Held relationship previews are never written.
- Historical team aliases resolve only to existing registry entries; `teams.json` is immutable.
- Existing canonical immutable identity and asset fields are not changed by perspective appends.
- No automatic canonical merge, identity merge, team registration, route creation, publication, index eligibility, or ad eligibility is authorized.
- Every imported trade and player remains private, noindex, ad-free, sitemap-excluded, and navigation-excluded.
- Public Candidate is an editorial classification only and does not authorize publication.
- Phase 17H writes only `trades.json`, `players.json`, the private-import receipt, importer/tester source, and this contract when run through the guarded wrapper.
- No push or deployment is authorized.
