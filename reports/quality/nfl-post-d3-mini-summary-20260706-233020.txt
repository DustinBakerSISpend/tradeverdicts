# NFL Post-D3 Mini Summary
Generated: 2026-07-06 23:30:20
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

## Regenerate D3 Player+Pick Review
```text
OK
```

## D3 Apply Summary
- candidateStrictTotal: 103
- candidateWarningExcluded: 9
- manualExcluded: 21
- blockedExcluded: 0
- plannedCandidates: 103
- tradesTouched: 103
- teamBucketsTouched: 103
- bundledAssetsReplaced: 103
- standaloneAssetsCreated: 206
- playerAssetsCreated: 103
- pickAssetsCreated: 103
- netAssetIncrease: 103
- applied: true
- errors: 0
- warnings: 0
- backupPath: src\data\nfl\trades.json.d3-strict-player-pick-split-backup-1783398453350.bak

## Updated V3 Duplicate Sweep Summary
- tradesScanned: 5395
- teamsScanned: 10803
- tradesChanged: 39
- teamBucketsChanged: 41
- assetsRemoved: 41
- sameSinglePurePickDuplicateRemovals: 41
- specialCaseFixes: 1
- manualAssetStructureHolds: 852

## Updated Hold Triage Summary
- totalHolds: 852
- A_clean_unavailable_suffix_then_reaudit: 0
- B_probable_duplicate_pick_manual_patch: 62
- C_multi_pick_bundle_needs_split: 306
- D_player_plus_pick_bundle_needs_split: 114
- E_ptbnl_historical_bundle_review: 2
- F_considerations_bundle_review: 7
- G_cash_bundle_review: 6
- H_or_alternative_source_conflict: 12
- I_other_asset_structure_review: 343

## Updated Split-Candidate Summary
- totalCandidates: 852
- S1_clean_multi_pick_split_plus_dedupe_candidate: 308
- S2_clean_multi_pick_split_candidate: 7
- S3_multi_pick_bundle_complex_review: 26
- S4_player_plus_pick_bundle_review: 133
- S5_cash_consideration_ptbnl_or_conditional_review: 45
- S6_other_split_review: 333

## Updated C/D Lane Summary
- totalCandidatesFromSplitJson: 852
- targetBucketsFound: 852
- assetsExamined: 1330
- multiPickAssetsExamined: 341
- playerPickAssetsExamined: 158
- errors: 0
- C3_and_word_multi_pick_review: 123
- C4_multi_pick_other_review: 11
- D3_player_pick_review_no_clean_comma_split: 30

## Updated D3 Review Summary
- totalD3SourceItems: 30
- totalReviewed: 30
- candidateStrictCount: 0
- candidateWarningCount: 9
- manualCount: 21
- blockedCount: 0
- currentTextMismatchCount: 0
- duplicateWarningCount: 10
- errors: 0
- D3A_and_clean_player_plus_clean_pick_candidate: 9
- D3Z_other_player_pick_manual_review: 21

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
Split strict D3 player-pick bundles
