# Atlanta Hawks Phase 3A reviewed intake contract

Phase 3A promotes the reconciled Atlanta Hawks workbook into the private NBA
repository as a reviewed source batch. It also adds date-aware historical team
lineage support and six defunct franchises required by the 1948–2026 history.

This phase does **not** create canonical trades, import players, add NBA routes,
or authorize publication.

## Exact reviewed-batch expectations

- 308 source rows
- 287 two-team rows and 21 multi-team rows
- 298 new canonical candidates
- 1 exact existing-canonical perspective match
- 4 follow-up rows to merge
- 4 duplicate/source variants to exclude or reconcile
- 1 source conflict
- 13 insufficient-evidence records with N/A grades
- 89 public candidates
- 159 research-before-public records
- 51 private/noindex archive records
- 9 merge/exclude records

## Historical team handling

Current franchise lineages are used for labels such as Nationals, Royals,
Braves, Sonics, Zephyrs, Bobcats, and historical Lakers/Jazz/Warriors names.

The following defunct franchises remain distinct and are added to the private
team registry:

- Anderson Packers
- original Baltimore Bullets (1944–1954)
- Chicago Stags
- Sheboygan Red Skins
- St. Louis Bombers
- Washington Capitols

`Bullets` and `Packers` are resolved with date-bounded rules because those
labels identify different franchises in different eras.

## Safety

- Canonical `trades.json` remains unchanged at 27 records.
- `players.json` remains unchanged at 67 records.
- Existing private query, route-model, local-build, privacy, sitemap, and
  public-link isolation tests must continue to pass.
- The Atlanta batch remains private, noindex, ad-free, and import-blocked.
- No push, preview deployment, or production deployment is authorized.
