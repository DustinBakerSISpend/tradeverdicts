# NFL QA Duplicate-Asset Night Summary
Generated: 2026-07-06 01:51:00
Repo: C:\Users\dusti\tradeverdicts

## Executive Summary
- Latest checkpoint should be commit e1fc196: Split strict NFL multi-pick assets.
- Bottom Batch 029 is closed; total NFL QA accounted remains 3,000 records.
- Safe suffix cleanup is done: A_clean_unavailable_suffix_then_reaudit should be 0.
- Strict split v2 applied only the tiny safe lane; unsafe broad split v1 must not be reused.
- Remaining duplicate-asset work is mostly reviewed bundle cleanup: and/or wording, explanatory pick clauses, player+pick bundles, cash/consideration/PTBNL, and other structure cases.

## Git Status
## main...origin/main
 M reports/quality/nfl-asset-bundle-split-candidates-v1.json
 M reports/quality/nfl-asset-bundle-split-candidates-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.json
 M reports/quality/nfl-global-asset-structure-holds-triage-v1.txt
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.json
 M reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.txt
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.json
 M reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt

## Recent Commits
e1fc196 (HEAD -> main, origin/main) Split strict NFL multi-pick assets
cbcdd5a Clean global NFL asset hold suffixes
be0c68d Clean NFL bottom batch 029
6073606 Clean NFL bottom batch 029
2d5c53a Clean NFL bottom batch 028
7d7360d Clean NFL bottom batch 027
ec5b525 Clean NFL bottom batch 026
365f18e Clean NFL bottom batch 025

## Current Diff Stat
warning: in the working copy of 'reports/quality/nfl-asset-bundle-split-candidates-v1.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-asset-bundle-split-candidates-v1.txt', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-global-asset-structure-holds-triage-v1.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-global-asset-structure-holds-triage-v1.txt', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-global-asset-structure-holds-v3-ultrasafe.txt', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'reports/quality/nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt', LF will be replaced by CRLF the next time Git touches it
 .../nfl-asset-bundle-split-candidates-v1.json      |  442 ++-
 .../nfl-asset-bundle-split-candidates-v1.txt       |   58 +-
 ...nfl-global-asset-structure-holds-triage-v1.json |  433 ++-
 .../nfl-global-asset-structure-holds-triage-v1.txt |   25 +-
 ...-global-asset-structure-holds-v3-ultrasafe.json |  349 +--
 ...l-global-asset-structure-holds-v3-ultrasafe.txt | 2845 ++++++++++----------
 ...global-duplicate-assets-sweep-v3-ultrasafe.json |  116 +-
 ...-global-duplicate-assets-sweep-v3-ultrasafe.txt |   85 +-
 8 files changed, 2033 insertions(+), 2320 deletions(-)

## Bottom Batch 029
- clean_after_manifest_scan: 99
001. id=SF-1981-0192 originalIndex=2504 currentIndex=2504 finalState=clean_after_manifest_scan issues=
002. id=CLE-1981-0231 originalIndex=2505 currentIndex=2505 finalState=clean_after_manifest_scan issues=
003. id=DAL-1981-0161 originalIndex=2506 currentIndex=2506 finalState=clean_after_manifest_scan issues=
004. id=DEN-1981-08-25-0172 originalIndex=2507 currentIndex=2507 finalState=clean_after_manifest_scan issues=
005. id=WAS-1981-0277 originalIndex=2508 currentIndex=2508 finalState=clean_after_manifest_scan issues=
006. id=DEN-1981-08-31-0173 originalIndex=2509 currentIndex=2509 finalState=clean_after_manifest_scan issues=
007. id=DEN-1981-08-31-0174 originalIndex=2510 currentIndex=2510 finalState=clean_after_manifest_scan issues=
008. id=IND-1981-0220 originalIndex=2511 currentIndex=2511 finalState=clean_after_manifest_scan issues=
009. id=LAC-1981-0200 originalIndex=2512 currentIndex=2512 finalState=clean_after_manifest_scan issues=
010. id=MIN-1981-08-31-0144 originalIndex=2513 currentIndex=2513 finalState=clean_after_manifest_scan issues=
011. id=NYG-1981-0219 originalIndex=2514 currentIndex=2514 finalState=clean_after_manifest_scan issues=
012. id=TB-1981-0075 originalIndex=2515 currentIndex=2515 finalState=clean_after_manifest_scan issues=
013. id=TB-1981-0076 originalIndex=2516 currentIndex=2516 finalState=clean_after_manifest_scan issues=
014. id=WAS-1981-0279 originalIndex=2517 currentIndex=2517 finalState=clean_after_manifest_scan issues=
015. id=SF-1981-0195 originalIndex=2518 currentIndex=2518 finalState=clean_after_manifest_scan issues=
016. id=LAC-1981-0202 originalIndex=2519 currentIndex=2519 finalState=clean_after_manifest_scan issues=
017. id=LAC-1981-0203 originalIndex=2520 currentIndex=2520 finalState=clean_after_manifest_scan issues=
018. id=SEA-1981-09-25-0031 originalIndex=2521 currentIndex=2521 finalState=clean_after_manifest_scan issues=
019. id=LAC-1981-0204 originalIndex=2522 currentIndex=2522 finalState=clean_after_manifest_scan issues=
020. id=NYG-1981-0220 originalIndex=2523 currentIndex=2523 finalState=clean_after_manifest_scan issues=
021. id=SF-1981-0196 originalIndex=2524 currentIndex=2524 finalState=clean_after_manifest_scan issues=
022. id=SF-1981-0197 originalIndex=2525 currentIndex=2525 finalState=clean_after_manifest_scan issues=
023. id=LAC-1981-0206 originalIndex=2526 currentIndex=2526 finalState=clean_after_manifest_scan issues=
024. id=SEA-1981-10-13-0032 originalIndex=2527 currentIndex=2527 finalState=clean_after_manifest_scan issues=
025. id=SEA-1981-10-13-0033 originalIndex=2528 currentIndex=2528 finalState=clean_after_manifest_scan issues=
026. id=LAC-1982-0207 originalIndex=2529 currentIndex=2529 finalState=clean_after_manifest_scan issues=
027. id=TB-1982-0078 originalIndex=2530 currentIndex=2530 finalState=clean_after_manifest_scan issues=
028. id=LAC-1982-0209 originalIndex=2531 currentIndex=2531 finalState=clean_after_manifest_scan issues=
029. id=BUF-1982-0197 originalIndex=2532 currentIndex=2532 finalState=clean_after_manifest_scan issues=
030. id=LAC-1982-0210 originalIndex=2533 currentIndex=2533 finalState=clean_after_manifest_scan issues=
031. id=BUF-1982-0199 originalIndex=2534 currentIndex=2534 finalState=clean_after_manifest_scan issues=
032. id=BUF-1982-0200 originalIndex=2535 currentIndex=2535 finalState=clean_after_manifest_scan issues=
033. id=DEN-1982-04-27-0175 originalIndex=2536 currentIndex=2536 finalState=clean_after_manifest_scan issues=
034. id=DEN-1982-04-27-0176 originalIndex=2537 currentIndex=2537 finalState=clean_after_manifest_scan issues=
035. id=KC-1982-0133 originalIndex=2538 currentIndex=2538 finalState=clean_after_manifest_scan issues=
036. id=LAC-1982-0211 originalIndex=2539 currentIndex=2539 finalState=clean_after_manifest_scan issues=
037. id=NO-1982-0195 originalIndex=2540 currentIndex=2540 finalState=clean_after_manifest_scan issues=
038. id=RAM-1982-0319 originalIndex=2541 currentIndex=2541 finalState=clean_after_manifest_scan issues=
039. id=RAM-1982-0320 originalIndex=2542 currentIndex=2542 finalState=clean_after_manifest_scan issues=
040. id=SF-1982-0198 originalIndex=2543 currentIndex=2543 finalState=clean_after_manifest_scan issues=
041. id=TB-1982-0080 originalIndex=2544 currentIndex=2544 finalState=clean_after_manifest_scan issues=
042. id=CHI-1982-0328 originalIndex=2545 currentIndex=2545 finalState=clean_after_manifest_scan issues=
043. id=CLE-1982-0235 originalIndex=2546 currentIndex=2546 finalState=clean_after_manifest_scan issues=
044. id=DET-1982-0239 originalIndex=2547 currentIndex=2547 finalState=clean_after_manifest_scan issues=
045. id=DET-1982-0240 originalIndex=2548 currentIndex=2548 finalState=clean_after_manifest_scan issues=
046. id=SEA-1982-04-28-0034 originalIndex=2549 currentIndex=2549 finalState=clean_after_manifest_scan issues=
047. id=WAS-1982-0281 originalIndex=2550 currentIndex=2550 finalState=clean_after_manifest_scan issues=
048. id=CLE-1982-0237 originalIndex=2551 currentIndex=2551 finalState=clean_after_manifest_scan issues=
049. id=CHI-1982-0329 originalIndex=2552 currentIndex=2552 finalState=clean_after_manifest_scan issues=
050. id=IND-1982-0222 originalIndex=2553 currentIndex=2553 finalState=clean_after_manifest_scan issues=
051. id=MIN-1982-0141 originalIndex=2554 currentIndex=2554 finalState=clean_after_manifest_scan issues=
052. id=SF-1982-0200 originalIndex=2555 currentIndex=2555 finalState=clean_after_manifest_scan issues=
053. id=NO-1982-0197 originalIndex=2556 currentIndex=2556 finalState=clean_after_manifest_scan issues=
054. id=IND-1982-0223 originalIndex=2557 currentIndex=2557 finalState=clean_after_manifest_scan issues=
055. id=LAC-1982-0215 originalIndex=2558 currentIndex=2558 finalState=clean_after_manifest_scan issues=
056. id=DET-1982-0241 originalIndex=2559 currentIndex=2559 finalState=clean_after_manifest_scan issues=
057. id=GB-1982-0246 originalIndex=2560 currentIndex=2560 finalState=clean_after_manifest_scan issues=
058. id=GB-1982-0247 originalIndex=2561 currentIndex=2561 finalState=clean_after_manifest_scan issues=
059. id=KC-1982-0136 originalIndex=2562 currentIndex=2562 finalState=clean_after_manifest_scan issues=
060. id=SF-1982-0201 originalIndex=2563 currentIndex=2563 finalState=clean_after_manifest_scan issues=
061. id=NO-1982-0199 originalIndex=2564 currentIndex=2564 finalState=clean_after_manifest_scan issues=
062. id=NYG-1982-0222 originalIndex=2565 currentIndex=2565 finalState=clean_after_manifest_scan issues=
063. id=CLE-1982-0238 originalIndex=2566 currentIndex=2566 finalState=clean_after_manifest_scan issues=
065. id=DEN-1982-08-18-0177 originalIndex=2568 currentIndex=2567 finalState=clean_after_manifest_scan issues=
066. id=MIN-1982-0142 originalIndex=2569 currentIndex=2568 finalState=clean_after_manifest_scan issues=
067. id=CIN-1982-0090 originalIndex=2570 currentIndex=2569 finalState=clean_after_manifest_scan issues=
068. id=CLE-1982-0239 originalIndex=2571 currentIndex=2570 finalState=clean_after_manifest_scan issues=
069. id=MIN-1982-0143 originalIndex=2572 currentIndex=2571 finalState=clean_after_manifest_scan issues=
070. id=LAC-1982-0216 originalIndex=2573 currentIndex=2572 finalState=clean_after_manifest_scan issues=
071. id=WAS-1982-0282 originalIndex=2574 currentIndex=2573 finalState=clean_after_manifest_scan issues=
072. id=ATL-1982-0148 originalIndex=2575 currentIndex=2574 finalState=clean_after_manifest_scan issues=
073. id=DEN-1982-08-30-0178 originalIndex=2576 currentIndex=2575 finalState=clean_after_manifest_scan issues=
074. id=SF-1982-0202 originalIndex=2577 currentIndex=2576 finalState=clean_after_manifest_scan issues=
075. id=ATL-1982-0149 originalIndex=2578 currentIndex=2577 finalState=clean_after_manifest_scan issues=
076. id=IND-1982-0225 originalIndex=2579 currentIndex=2578 finalState=clean_after_manifest_scan issues=
077. id=LAC-1982-0217 originalIndex=2580 currentIndex=2579 finalState=clean_after_manifest_scan issues=
078. id=WAS-1982-0283 originalIndex=2581 currentIndex=2580 finalState=clean_after_manifest_scan issues=
079. id=IND-1982-0226 originalIndex=2582 currentIndex=2581 finalState=clean_after_manifest_scan issues=
080. id=RAM-1982-0323 originalIndex=2583 currentIndex=2582 finalState=clean_after_manifest_scan issues=
081. id=DEN-1982-09-06-0179 originalIndex=2584 currentIndex=2583 finalState=clean_after_manifest_scan issues=
082. id=SF-1982-0203 originalIndex=2585 currentIndex=2584 finalState=clean_after_manifest_scan issues=
083. id=NO-1982-0202 originalIndex=2586 currentIndex=2585 finalState=clean_after_manifest_scan issues=
084. id=RAM-1983-0324 originalIndex=2587 currentIndex=2586 finalState=clean_after_manifest_scan issues=
085. id=BUF-1983-0201 originalIndex=2588 currentIndex=2587 finalState=clean_after_manifest_scan issues=
086. id=LAC-1983-0218 originalIndex=2589 currentIndex=2588 finalState=clean_after_manifest_scan issues=
087. id=SF-1983-0204 originalIndex=2590 currentIndex=2589 finalState=clean_after_manifest_scan issues=
088. id=SF-1983-0205 originalIndex=2591 currentIndex=2590 finalState=clean_after_manifest_scan issues=
089. id=RAM-1983-0325 originalIndex=2592 currentIndex=2591 finalState=clean_after_manifest_scan issues=
090. id=SEA-1983-04-24-0037 originalIndex=2593 currentIndex=2592 finalState=clean_after_manifest_scan issues=
091. id=RAM-1983-0326 originalIndex=2594 currentIndex=2593 finalState=clean_after_manifest_scan issues=
092. id=DET-1983-0242 originalIndex=2595 currentIndex=2594 finalState=clean_after_manifest_scan issues=
093. id=MIA-1983-0111 originalIndex=2596 currentIndex=2595 finalState=clean_after_manifest_scan issues=
094. id=NO-1983-0204 originalIndex=2597 currentIndex=2596 finalState=clean_after_manifest_scan issues=
095. id=NYG-1983-0225 originalIndex=2598 currentIndex=2597 finalState=clean_after_manifest_scan issues=
096. id=RAI-1983-0181 originalIndex=2599 currentIndex=2598 finalState=clean_after_manifest_scan issues=
097. id=SF-1983-0207 originalIndex=2600 currentIndex=2599 finalState=clean_after_manifest_scan issues=
098. id=SF-1983-0208 originalIndex=2601 currentIndex=2600 finalState=clean_after_manifest_scan issues=
099. id=CLE-1983-0240 originalIndex=2602 currentIndex=2601 finalState=clean_after_manifest_scan issues=
100. id=DEN-1983-05-02-0180 originalIndex=2603 currentIndex=2602 finalState=clean_after_manifest_scan issues=
- quarantined_or_missing: 1
064. id=RAI-1982-0179 originalIndex=2567 currentIndex=null finalState=quarantined_or_missing issues=
## Non-clean Records
- None
- id=RAI-1982-0179 originalIndex=2567 slug=unknown-1982

## Global Duplicate-Asset Sweep v3 Current Dry-Run Counts
- tradesScanned: 5395
- teamsScanned: 10803
- tradesChanged: 2
- teamBucketsChanged: 1
- assetsRemoved: 1
- textCleanups: 0
- placeholderOnlyRemovals: 0
- bareUnknownNotDisclosedRemovals: 0
- exactDuplicateRemovals: 0
- sameSinglePurePickDuplicateRemovals: 1
- specialCaseFixes: 1
- manualAssetStructureHolds: 1629

## Pending Safe Removals Shown by v3 Report
- id=JAX-1999-0012 team=tampa-bay-buccaneers slug=1999-6th-round-pick-182nd-overall-tampa-bay-buccaneers-1999
  - same_single_pure_pick_duplicate: remove [1999 6th round pick (195th overall]; keep [1999 6th round pick (195th overall, Lamarr Glenn)]

## Current Hold Triage
- totalHolds: 1629
- A_clean_unavailable_suffix_then_reaudit: 0
- B_probable_duplicate_pick_manual_patch: 103
- C_multi_pick_bundle_needs_split: 980
- D_player_plus_pick_bundle_needs_split: 216
- E_ptbnl_historical_bundle_review: 2
- F_considerations_bundle_review: 7
- G_cash_bundle_review: 6
- H_or_alternative_source_conflict: 12
- I_other_asset_structure_review: 303

## B Subtriage
- totalBItems: 103
- B1_exact_duplicate_single_pick_auto_candidate: 0
- B2_same_pick_single_pick_wording_candidate: 0
- B3_duplicate_inside_multi_pick_bundle_needs_split: 73
- B4_duplicate_inside_player_plus_pick_bundle_needs_split: 19
- B5_duplicate_inside_other_bundle_review: 11
- B6_unclear_probable_duplicate_review: 0

## Bundle Split Candidate Triage
- totalCandidates: 1629
- S1_clean_multi_pick_split_plus_dedupe_candidate: 1021
- S2_clean_multi_pick_split_candidate: 8
- S3_multi_pick_bundle_complex_review: 27
- S4_player_plus_pick_bundle_review: 235
- S5_cash_consideration_ptbnl_or_conditional_review: 45
- S6_other_split_review: 293

## Strict S1/S2 Split Apply v2
- strictBucketsChangedThisRun: 21
- tradesChangedThisRun: 20
- strictMultiPickAssetsSplit: 21
- strictSplitSegmentsCreated: 44
- duplicateAssetsRemovedAfterStrictSplit: 2
- exactDuplicateRemovalsAfterStrictSplit: 2
- sameSinglePurePickDuplicateRemovalsAfterStrictSplit: 0
- unsafePreviewSegments: 0
- errors: 0

## Recent Quality Report Files
- 2026-07-06 01:48:36 | 18991 bytes | nfl-qa-small-summary-20260706-014836.md
- 2026-07-06 01:48:36 | 18991 bytes | nfl-qa-small-summary-20260706-014836.txt
- 2026-07-06 01:46:42 | 1336653 bytes | nfl-asset-bundle-split-candidates-v1.json
- 2026-07-06 01:46:42 | 51587 bytes | nfl-asset-bundle-split-candidates-v1.txt
- 2026-07-06 01:46:42 | 8229 bytes | triage-nfl-asset-bundle-split-candidates-v1.cjs
- 2026-07-06 01:46:41 | 137881 bytes | nfl-b-probable-duplicate-pick-subtriage-v1.json
- 2026-07-06 01:46:41 | 22176 bytes | nfl-b-probable-duplicate-pick-subtriage-v1.txt
- 2026-07-06 01:46:41 | 6935 bytes | subtriage-nfl-b-probable-duplicate-picks-v1.cjs
- 2026-07-06 01:46:40 | 40103 bytes | nfl-global-asset-structure-holds-triage-v1.txt
- 2026-07-06 01:46:40 | 1238993 bytes | nfl-global-asset-structure-holds-triage-v1.json
- 2026-07-06 01:46:40 | 6356 bytes | triage-nfl-global-asset-structure-holds-v1.cjs
- 2026-07-06 01:46:38 | 1113094 bytes | nfl-global-asset-structure-holds-v3-ultrasafe.json
- 2026-07-06 01:46:38 | 577490 bytes | nfl-global-asset-structure-holds-v3-ultrasafe.txt
- 2026-07-06 01:46:38 | 7418 bytes | nfl-global-duplicate-assets-sweep-v3-ultrasafe.json
- 2026-07-06 01:46:38 | 521974 bytes | nfl-global-duplicate-assets-sweep-v3-ultrasafe.txt

## Next Step
- Current data is pushed through strict split commit e1fc196.
- Reports are modified because they were regenerated after the strict split.
- v3 now appears to show one safe same-pick duplicate removal still pending; inspect it before deciding whether to patch/apply.
- After resolving or deferring that one pending safe removal, commit refreshed reports or discard them, then run the final public-copy sanity scan/build.
