# Boston Celtics Phase 4H — Guarded Private Import

## Starting checkpoint

`b449a90796fa3562ca23684db662b68fd3d3f191`

## Purpose

Phase 4H imports only the packages released by the Phase 4G partition.

The importer:

- creates ready Boston and shared Atlanta/Boston canonical records;
- appends ready Boston perspectives to existing canonical records;
- creates only the player shells required by imported packages;
- activates only the relationship references belonging to imported packages;
- leaves every held package and unresolved identity untouched; and
- writes one receipt that owns the exact post-import trade and player stores.

## Write scope

The only data-store writes are:

- `src/data/nba/trades.json`
- `src/data/nba/players.json`
- `src/data/nba/imports/boston-celtics-phase-4h-private-import.json`

The reusable importer, test, and this contract are also committed.

## Idempotence

The importer is executed twice before commit. The first run performs the guarded
write. The second run must identify the receipt and prove that both stores are
byte-identical to its recorded hashes while performing zero writes.

## Held-package policy

Packages with unresolved player identities or an already-present Boston
perspective remain held. Their proposed canonical IDs are explicitly checked to
ensure that they were not imported.

## Privacy and deployment policy

Every new record remains private, noindex, ad-free, sitemap-excluded, and
publicly unlinked.

- Automatic merges: 0
- Automatic routes: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no


## Legacy asset-ID normalization

One historically corrected Boston source asset has no original `assetId`.
Phase 4H may assign an ID only when the frozen Phase 4F/4G relationship data
contains exactly one matching synthetic asset reference for the same package,
asset type, relationship role, and player identity.

The imported canonical asset preserves:

- `sourceAssetId: null`;
- `syntheticAssetReference: true`; and
- the relationship ID that supplied the deterministic reference.

No upstream reviewed record or prior freeze is modified.


## Non-player legacy asset IDs

A historically corrected non-player asset may also lack an original `assetId`
and therefore have no player relationship that can supply one. In that narrow
case, Phase 4H creates a deterministic ID from the frozen package ID, ledger
ordinal, type, description, route, direction, player/draft-outcome names, and
status.

The imported asset records:

- `sourceAssetId: null`;
- `syntheticAssetReference: true`;
- `syntheticAssetReferenceMethod: deterministic-canonical-asset-fields`;
- the complete SHA-256 fingerprint source; and
- the frozen ledger ordinal.

This is an import-boundary normalization only. It does not alter the reviewed
source row or any prior freeze.


## Existing-canonical perspective relationship policy

A Boston perspective append does not modify the target canonical asset ledger.
Therefore its Boston source-ledger relationship previews must not be activated
as player references against that existing canonical record. Doing so would
create references to asset IDs that do not exist in the target ledger.

Phase 4H activates player references only for newly imported canonical-create
and shared-canonical-create packages. Existing canonical records retain their
already-valid asset/player relationships while receiving only the Boston
perspective, grade, source submission, and reconciliation metadata.


## Exact relationship-reference vocabulary

The repository relationship graph derives expected keys from canonical assets:

- `player` asset -> `direct_player`
- `draft_rights` asset -> `draft_rights`
- asset with `becamePlayerName` -> `draft_outcome`

Phase 4H must use those exact values in player `sourceReferences`.
The import test calls the repository relationship graph directly and requires
zero missing, extra, invalid, or duplicate-owned references before the query
index or route models may pass.
