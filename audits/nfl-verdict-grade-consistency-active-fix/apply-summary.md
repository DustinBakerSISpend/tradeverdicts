# Task 2 active candidate fix

Mode: APPLY
Data file: src/data/nfl/trades.json
Changed fields if applied: 11
Validation failures: 0

## Changes

- CHANGED: 1978-fifth-round-pick-127-archie-reese-houston-oilers-1976 / team alias - Replace active-record Tennessee Titans contamination with Houston Oilers for this Oilers-era trade.
- CHANGED: 1978-fifth-round-pick-127-archie-reese-houston-oilers-1976 / summary - Remove narrow-win prose from an Even Trade record.
- CHANGED: 2006-7th-round-pick-213th-overall-san-francisco-49ers-2006 / summary - Align summary with Jaguars Win and C+ / C- grade spread.
- CHANGED: 2006-7th-round-pick-213th-overall-san-francisco-49ers-2006 / partnerSummary - Remove clean-even wording from partnerSummary.
- CHANGED: 2006-7th-round-pick-213th-overall-san-francisco-49ers-2006 / analysis - Remove clean-even wording from analysis.
- CHANGED: 2023-1st-round-pick-27th-overall-buffalo-bills-2023 / partnerSummary - Align literal partner Grade token with Buffalo B team card.
- CHANGED: dan-arnold-carolina-panthers-2021 / partnerSummary - Align Panthers literal Grade token with Carolina D team card.
- CHANGED: dan-arnold-carolina-panthers-2021 / analysis - Align Panthers literal Grade token with Carolina D team card.
- CHANGED: rights-to-joe-kopcha-chicago-bears-1936-09-25 / summary - Align summary with Detroit Lions Win and B / C grade spread.
- CHANGED: rights-to-joe-kopcha-chicago-bears-1936-09-25 / partnerSummary - Remove even-verdict wording from partnerSummary.
- CHANGED: rights-to-joe-kopcha-chicago-bears-1936-09-25 / analysis - Remove even-verdict wording from analysis.

## Notes

- skipped-active-clean: 2005-4th-round-pick-127th-overall-new-york-jets-2005 - Bad Grade: B tokens were found in old reimport files; active trades.json has no Grade: B token to patch.
- skipped-active-clean: david-jones-cincinnati-bengals-2010 - Bad Grade: B tokens were found in old reimport files; active trades.json has no Grade: B token to patch.

## Validation

- PASS: 1978-fifth-round-pick-127-archie-reese-houston-oilers-1976 / summary - summary must not say narrow Chiefs win
- PASS: 1978-fifth-round-pick-127-archie-reese-houston-oilers-1976 / summary - summary should still support even verdict
- PASS: 1978-fifth-round-pick-127-archie-reese-houston-oilers-1976 / teams - teams must include houston-oilers and not tennessee-titans
- PASS: 2006-7th-round-pick-213th-overall-san-francisco-49ers-2006 / summary - summary must not say no clear win
- PASS: 2006-7th-round-pick-213th-overall-san-francisco-49ers-2006 / partnerSummary - partnerSummary must not say clean even trade
- PASS: 2006-7th-round-pick-213th-overall-san-francisco-49ers-2006 / analysis - analysis must not say clean even trade
- PASS: 2023-1st-round-pick-27th-overall-buffalo-bills-2023 / partnerSummary - partnerSummary must say Grade: B, not Grade: C+
- PASS: dan-arnold-carolina-panthers-2021 / partnerSummary - partnerSummary must say Grade: D, not Grade: C
- PASS: dan-arnold-carolina-panthers-2021 / analysis - analysis must say Grade: D, not Grade: C
- PASS: rights-to-joe-kopcha-chicago-bears-1936-09-25 / summary - summary must not say no directional win
- PASS: rights-to-joe-kopcha-chicago-bears-1936-09-25 / partnerSummary - partnerSummary must not say even verdict
- PASS: rights-to-joe-kopcha-chicago-bears-1936-09-25 / analysis - analysis must not say even verdict

No build was run.
