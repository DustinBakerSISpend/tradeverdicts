# Ramsey public search data patch

Mode: APPLY
Data file: src/data/nfl/trades.json
Would change data file: true
Validation failures: 0

## Changes

- UNCHANGED: 2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019 / publishStatus - Ensure the 2019 Jalen Ramsey landmark trade is public-searchable. (ready -> ready)
- CHANGED: 2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019 / tier - Give the 2019 Jalen Ramsey Jaguars-Rams trade landmark treatment in search ranking. (major -> landmark)
- CHANGED: 2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019 / suppressed - Remove boolean suppressed flag from 2019 Ramsey trade. (true -> false)
- CHANGED: jalen-ramsey-jonnu-smith-miami-dolphins-2025 / publishStatus - Make the 2025 Jalen Ramsey/Jonnu Smith/Minkah Fitzpatrick trade public-searchable. (suppressed -> ready)
- UNCHANGED: jalen-ramsey-jonnu-smith-miami-dolphins-2025 / tier - Keep the 2025 Ramsey trade major, not landmark. (major -> major)
- CHANGED: jalen-ramsey-jonnu-smith-miami-dolphins-2025 / suppressed - Remove boolean suppressed flag from 2025 Ramsey trade. (true -> false)

## Public exact Jalen Ramsey records after patch

- index 4783 | 2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019 | publishStatus=ready | tier=landmark | confidence=high
- index 5058 | jalen-ramsey-rams-2023 | publishStatus=ready | tier=major | confidence=high
- index 5279 | jalen-ramsey-jonnu-smith-miami-dolphins-2025 | publishStatus=ready | tier=major | confidence=medium

## Validation

- PASS: 2019 Ramsey trade is public
- PASS: 2019 Ramsey trade is landmark
- PASS: 2023 Ramsey trade remains public
- PASS: 2025 Ramsey trade is public
- PASS: All three expected Ramsey slugs are public exact Jalen Ramsey matches
- PASS: Search page exposes tier to client index
- PASS: Search page scores results before date sorting

## Failures

- None

No build was run.
