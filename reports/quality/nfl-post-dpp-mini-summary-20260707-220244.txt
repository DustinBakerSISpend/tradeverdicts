# NFL Post-DPP Mini Summary
Generated: 2026-07-07 22:02:44
Repo: C:\Users\dusti\tradeverdicts

## Initial Git Status
## main...origin/main
 M src/data/nfl/trades.json

## Diff Check Before Regen
```text
OK
```

## Regenerate V3 Duplicate Sweep
```text
OK
```

## Regenerate Hold Triage
```text
OK
```

## Regenerate B Subtriage
```text
OK
```

## Regenerate Split-Candidate Triage
```text
OK
```

## Regenerate C/D Lane Preview
```text
OK
```

## Regenerate D3 Remaining Review
```text
OK
```

## Regenerate DPP Remaining Strict Review
```text
OK
```

## DPP Apply Summary
- candidateStrictTotal: 14
- candidateWarningExcluded: 0
- manualExcluded: 119
- blockedExcluded: 0
- plannedCandidates: 14
- tradesTouched: 14
- teamBucketsTouched: 14
- bundlesRemovedOrReplaced: 14
- playerAssetsCreated: 1
- pickAssetsCreated: 10
- standaloneAssetsCreated: 11
- existingPlayerAssetsVerified: 13
- existingPickAssetsVerified: 4
- netAssetChange: -3
- applied: true
- errors: 0
- warnings: 0
- backupPath: src\data\nfl\trades.json.dpp-strict-player-pick-remaining-backup-1783479686098.bak

## Updated Hold Triage Summary
- totalHolds: 836
- A_clean_unavailable_suffix_then_reaudit: 0
- B_probable_duplicate_pick_manual_patch: 46
- C_multi_pick_bundle_needs_split: 306
- D_player_plus_pick_bundle_needs_split: 114
- E_ptbnl_historical_bundle_review: 2
- F_considerations_bundle_review: 7
- G_cash_bundle_review: 6
- H_or_alternative_source_conflict: 12
- I_other_asset_structure_review: 343

## Updated Split-Candidate Summary
- totalCandidates: 836
- S1_clean_multi_pick_split_plus_dedupe_candidate: 306
- S2_clean_multi_pick_split_candidate: 7
- S3_multi_pick_bundle_complex_review: 26
- S4_player_plus_pick_bundle_review: 119
- S5_cash_consideration_ptbnl_or_conditional_review: 45
- S6_other_split_review: 333

## Updated D3 Remaining Review Summary
- totalD3SourceItems: 16
- totalReviewed: 16
- candidateStrictCount: 0
- candidateWarningCount: 0
- manualCount: 16
- blockedCount: 0
- duplicateWarningCount: 1
- errors: 0

## Updated DPP Remaining Strict Review Summary
- sourceS4Items: 119
- totalReviewed: 119
- candidateStrictCount: 0
- candidateWarningCount: 0
- manualCount: 119
- blockedCount: 0
- strictRemoveBundleAllPartsAlreadyExist: 0
- strictSplitCreateMissingDedupeExisting: 0
- strictSplitPlayerPickBundles: 0
- bundlesToReplaceOrRemoveIfStrictApplied: 0
- standaloneAssetsToCreateIfStrictApplied: 0
- netAssetChangeIfStrictApplied: 0
- errors: 0

## Final Git Status
## main...origin/main
 M reports/quality/nfl-asset-bundle-split-candidates-v1.json
 M reports/quality/nfl-asset-bundle-split-candidates-v1.txt
 M reports/quality/nfl-b-probable-duplicate-pick-subtriage-v1.json
 M reports/quality/nfl-b-probable-duplicate-pick-subtriage-v1.txt
 M reports/quality/nfl-cd-reviewed-bundle-lanes-preview-v1.json
 M reports/quality/nfl-cd-reviewed-bundle-lanes-preview-v1.txt
 M reports/quality/nfl-d3-player-pick-remaining-lanes-review-v1.csv
 M reports/quality/nfl-d3-player-pick-remaining-lanes-review-v1.json
 M reports/quality/nfl-d3-player-pick-remaining-lanes-review-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.json
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.json
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.txt
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.json
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt
 M src/data/nfl/trades.json

## Suggested Commit Message
Clean remaining strict DPP player-pick bundles
