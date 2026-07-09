# Search fast-path patch

Mode: APPLY
File: src/pages/search.astro
Would change file: true
Validation failures: 0

## Changes

- CHANGED: Add fastIncludesTerm helper
- CHANGED: Use fast pass before fuzzy fallback

## Validation

- PASS: fastIncludesTerm helper exists
- PASS: itemMatchesSearch helper exists
- PASS: rankResults helper exists
- PASS: fast pass is used before fuzzy fallback
- PASS: fuzzy fallback only runs when fast result count is below 3
- PASS: scoreSearchResult still exists
- PASS: landmark boost still exists
- PASS: compactSearchText remains in use

## Failures

- None

No build was run. No trade JSON was modified.
