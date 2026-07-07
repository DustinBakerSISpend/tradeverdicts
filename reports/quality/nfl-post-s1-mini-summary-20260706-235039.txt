# NFL Post-S1 Mini Summary
Generated: 2026-07-06 23:50:39
Repo: C:\Users\dusti\tradeverdicts

## Initial Git Status
## main...origin/main
 M reports/quality/nfl-asset-bundle-split-candidates-v1.json
 M reports/quality/nfl-asset-bundle-split-candidates-v1.txt
 M reports/quality/nfl-b-probable-duplicate-pick-subtriage-v1.json
 M reports/quality/nfl-b-probable-duplicate-pick-subtriage-v1.txt
 M reports/quality/nfl-cd-reviewed-bundle-lanes-preview-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.json
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.txt
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt
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

## Regenerate S1 Bundle Dedupe Review
```text
OK
```

## S1 Apply Summary
- candidateStrictTotal: 2
- candidateWarningExcluded: 19
- manualExcluded: 287
- blockedExcluded: 0
- plannedCandidates: 2
- tradesTouched: 2
- teamBucketsTouched: 2
- duplicateBundleAssetsRemoved: 2
- standalonePickAssetsVerifiedKept: 4
- netAssetChange: -2
- applied: true
- errors: 0
- warnings: 0
- backupPath: src\data\nfl\trades.json.s1-strict-bundle-dedupe-backup-1783399832638.bak

## Updated Hold Triage Summary
- totalHolds: 850
- A_clean_unavailable_suffix_then_reaudit: 0
- B_probable_duplicate_pick_manual_patch: 60
- C_multi_pick_bundle_needs_split: 306
- D_player_plus_pick_bundle_needs_split: 114
- E_ptbnl_historical_bundle_review: 2
- F_considerations_bundle_review: 7
- G_cash_bundle_review: 6
- H_or_alternative_source_conflict: 12
- I_other_asset_structure_review: 343

## Updated B Subtriage Summary
- totalBItems: 60
- B1_exact_duplicate_single_pick_auto_candidate: 0
- B2_same_pick_single_pick_wording_candidate: 0
- B3_duplicate_inside_multi_pick_bundle_needs_split: 30
- B4_duplicate_inside_player_plus_pick_bundle_needs_split: 19
- B5_duplicate_inside_other_bundle_review: 11
- B6_unclear_probable_duplicate_review: 0

## Updated Split-Candidate Summary
- totalCandidates: 850
- S1_clean_multi_pick_split_plus_dedupe_candidate: 306
- S2_clean_multi_pick_split_candidate: 7
- S3_multi_pick_bundle_complex_review: 26
- S4_player_plus_pick_bundle_review: 133
- S5_cash_consideration_ptbnl_or_conditional_review: 45
- S6_other_split_review: 333

## Updated S1 Bundle Dedupe Review Summary
- reportS1Items: 306
- totalReviewed: 306
- candidateStrictCount: 0
- candidateWarningCount: 19
- manualCount: 287
- blockedCount: 0
- removalAssetsIfStrictApplied: 0
- keepAssetsVerifiedIfStrictApplied: 0
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
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.json
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.json
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.txt
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.json
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt
 M src/data/nfl/trades.json

## Suggested Commit Message
Remove strict S1 duplicate pick bundles
