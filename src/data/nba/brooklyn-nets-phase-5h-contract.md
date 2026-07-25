# Brooklyn Nets Phase 5H v10 — Guarded Private Import

## Starting checkpoint

`79ac5ef42665a8b9f3a512d68d7b1ebd1d600700`

## Frozen import partition

- Ready packages: 205
- Held packages: 3
- New canonical trades: 201
- Existing-canonical Brooklyn perspectives: 4
- New private player shells: 296
- Ready asset-to-player relationships: 474
- Expected post-import canonical trades: 657
- Expected post-import players: 1,179
- Expected post-import represented teams: 50

## Player route-rendering schema

The shared private route-model builder passes each player record's `aliases` and
`referenceTypes` fields directly into the player-detail presentation model.
`PrivateNbaPage.astro` renders those fields as joined lists.

Every Phase 5H player shell therefore initializes:

- `aliases` as an array;
- `referenceTypes` as an array;
- `relationshipReferences` as an array.

When an asset-to-player relationship is attached, the importer also adds the
relationship's derived `referenceType` to the owning player's deduplicated,
sorted `referenceTypes` array.

Before any repository write, the importer verifies these fields for all 296
new shells and verifies every imported relationship against its owning player.

The Phase 5H contract test then builds all 1,890 private route models and
executes the same array joins required during Astro rendering:

- 1,179 player-detail models;
- 657 trade-detail models;
- 50 team-detail models;
- 4 private index models.

A missing render-array field therefore fails before `npm run build`.

## Historical team registry

The ready package partition requires nine reviewed ABA-era historical team
registrations. Each appended entry remains private, inactive, and defunct, and
records Phase 5H registry provenance.

## Store writes

The guarded import writes exactly four repository data files:

1. `trades.json`
2. `players.json`
3. `teams.json`
4. the Phase 5H import receipt

## Safety

The import remains private, noindex, ad-free, and unpublished. It performs no
automatic identity merge, automatic canonical merge, automatic route decision,
push, preview deployment, or production deployment. All three held packages
remain untouched. The immediate second import must be byte-idempotent and
perform zero repository writes.
