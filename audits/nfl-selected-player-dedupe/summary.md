# NFL selected-player display dedupe audit

JSON files scanned: 192
Candidate trade objects inspected: 52202
Total selected-player/player exact-name overlaps found: 14673

## Lane totals

- A_SAME_TEAM_EXACT_SELECTED_PLAYER_DUPLICATE: 9673
- B_SUBSEQUENTLY_TRADED_MANUAL: 1556
- C_CROSS_TEAM_OR_UNKNOWN_TEAM_MANUAL: 2559
- D_GENERIC_DRAFT_PICK_COMPENSATION: 885

## Meaning

- A = likely display-layer hide case: same team has PICK with selected player embedded and separate PLAYER asset of same name.
- B = manual: looks like selected player may have been subsequently traded or draft rights were involved.
- C = manual: selected player and PLAYER asset appear on different/unknown teams.
- D = separate lane: generic compensation/future-consideration artifacts.

No trade JSON was modified.
