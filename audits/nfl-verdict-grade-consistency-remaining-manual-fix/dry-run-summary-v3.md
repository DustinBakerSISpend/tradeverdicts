# Task 2 remaining manual candidate fix v3

Mode: DRY RUN
Data file: src/data/nfl/trades.json
Changed fields if applied: 16
Validation failures: 0

## Changes

- CHANGED: 1984-first-round-pick-28-brian-blados-las-vegas-raiders-1983 / analysis - Remove legacy even-trade wording from a clear Raiders Win record.
- CHANGED: 1996-1st-round-pick-6th-overall-lawrence-phillips-washington-redskins-1996 / analysis - Remove legacy even-trade wording from a clear Washington Win record.
- CHANGED: 2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002 / summary - Align summary wording with Jacksonville Jaguars Win without using even-trade negation.
- CHANGED: 2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002 / analysis - Align analysis wording with Jacksonville Jaguars Win without using even-trade negation.
- CHANGED: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / summary - Replace even-trade summary with Tampa Bay edge matching Bucs Win and B- / C+ grades.
- CHANGED: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / partnerSummary - Align literal partner Grade token with Tampa Bay B- team card.
- CHANGED: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / analysis - Align literal analysis Grade token with Tampa Bay B- team card.
- CHANGED: don-brown-a-arizona-st-louis-cardinals-1960 / partnerSummary - Replace Partner Partner Win artifact with even-trade partner language.
- CHANGED: henry-reed-new-york-giants-1975 / summary - Avoid win wording in an Even Trade summary.
- CHANGED: henry-reed-new-york-giants-1975 / analysis - Avoid win wording in an Even Trade analysis.
- CHANGED: jim-germany-arizona-st-louis-cardinals-1975 / partnerSummary - Replace Partner Partner Win artifact with even-trade partner language.
- CHANGED: jim-whalen-new-england-patriots-1970 / analysis - Avoid winner wording in an Even Trade analysis.
- CHANGED: larry-hickman-arizona-st-louis-cardinals-1960 / partnerSummary - Replace Partner Partner Win artifact with even-trade partner language.
- CHANGED: regan-upshaw-tampa-bay-buccaneers-1999 / verdict - Align verdict with active prose showing a slight Jaguars win and Tampa Bay player-value loss.
- CHANGED: regan-upshaw-tampa-bay-buccaneers-1999 / teamGrades - Align grade cards with Jacksonville Jaguars Win.
- CHANGED: regan-upshaw-tampa-bay-buccaneers-1999 / summary - Remove even-trade negation from a Jaguars Win summary.

## Validation

- PASS: 1984-first-round-pick-28-brian-blados-las-vegas-raiders-1983 / analysis - analysis should not include even trade wording
- PASS: 1996-1st-round-pick-6th-overall-lawrence-phillips-washington-redskins-1996 / analysis - analysis should not include even trade wording
- PASS: 2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002 / summary - summary should not include true even trade wording
- PASS: 2002-3rd-round-pick-89th-overall-washington-redskins-commanders-2002 / analysis - analysis should not include true even trade wording
- PASS: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / summary - summary should not say C+/C+ even trade
- PASS: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / partnerSummary - partnerSummary should say Grade: B-
- PASS: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / analysis - analysis should say Grade: B-
- PASS: 2022-1st-round-pick-27th-overall-tampa-bay-buccaneers-2022 / combined - combined prose should not say Grade: B without minus
- PASS: don-brown-a-arizona-st-louis-cardinals-1960 / partnerSummary - partnerSummary should not contain Partner Partner Win
- PASS: don-brown-a-arizona-st-louis-cardinals-1960 / partnerSummary - partnerSummary should support no directional winner
- PASS: jim-germany-arizona-st-louis-cardinals-1975 / partnerSummary - partnerSummary should not contain Partner Partner Win
- PASS: jim-germany-arizona-st-louis-cardinals-1975 / partnerSummary - partnerSummary should support no directional winner
- PASS: larry-hickman-arizona-st-louis-cardinals-1960 / partnerSummary - partnerSummary should not contain Partner Partner Win
- PASS: larry-hickman-arizona-st-louis-cardinals-1960 / partnerSummary - partnerSummary should support no directional winner
- PASS: henry-reed-new-york-giants-1975 / summary - summary should not say clear franchise-changing win
- PASS: henry-reed-new-york-giants-1975 / analysis - analysis should not say clear franchise-changing win
- PASS: jim-whalen-new-england-patriots-1970 / analysis - analysis should not say clear long-term winner
- PASS: regan-upshaw-tampa-bay-buccaneers-1999 / verdict - verdict should be Jacksonville Jaguars Win
- PASS: regan-upshaw-tampa-bay-buccaneers-1999 / teamGrades - Jacksonville should be B- and Tampa Bay C+
- PASS: regan-upshaw-tampa-bay-buccaneers-1999 / summary - summary should not include even trade wording

## Failures

- None

No build was run.
