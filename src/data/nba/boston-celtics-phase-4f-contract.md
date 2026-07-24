# Boston Celtics Phase 4F — Player Shell and Relationship Packaging Freeze

## Starting checkpoint contract

The current `nba-import` commit must be the successful Phase 4E checkpoint:

- commit message: `nba: freeze Boston canonical packaging eligibility`
- parent: `511209ef24169aa460443c5ff97a031335be60da`
- exact Phase 4E paths and blob hashes are guarded by the runner

This avoids requiring another user upload or a pasted Phase 4E commit hash.

## Purpose

Phase 4F converts Phase 4E's discovered player dependencies into exact private
player-shell packages and trade-player relationship previews.

The builder calculates all player and relationship counts from the current
509-player store and regenerated Phase 4E freeze. Counts are deliberately not
guessed or embedded.

## Rules

- Unique current-player matches produce relationship previews against the
  existing player ID.
- Missing players produce deterministic private shell packages and relationship
  previews against the provisional shell ID.
- Ambiguous player matches remain explicit holds. No automatic identity choice
  is permitted.
- Shared Atlanta/Boston packages remain blocked by the cross-team asset-union
  gate.
- No package authorizes an actual import or write.

## Safety

- Canonical imports: 0
- Player imports: 0
- Perspective writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic identity resolutions: 0
- Automatic merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no

Only the reusable Phase 4F builder, test, and contract are committed. Generated
shells, relationships, ambiguity holds, and package-readiness reports remain in
the verified backup directory.


## Deterministic fallback asset references

One historically corrected Phase 4C asset ledger predates the normal
`assetId` requirement. Phase 4F therefore resolves a missing source asset ID
by requiring exactly one player/role/type match inside that package and creates
a deterministic private fallback reference. The original absence is preserved
through `sourceAssetId: null` and `syntheticAssetReference: true`; no upstream
reviewed record or live store is modified.
