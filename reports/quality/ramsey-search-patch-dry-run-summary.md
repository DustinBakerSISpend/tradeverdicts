# Ramsey search ranking patch

Mode: DRY RUN
File: src/pages/search.astro
Would change file: true
Validation failures: 0

## Changes

- CHANGED: Add tier and confidence to searchIndex
- CHANGED: Tighten fuzzy token substring matching
- CHANGED: Add search result scoring helpers
- CHANGED: Sort search results by relevance score before date

## Validation

- PASS: searchIndex includes tier
- PASS: searchIndex includes confidence
- PASS: token.includes(candidate) now requires candidate length >= 5 and extra length
- PASS: scoreSearchResult helper exists
- PASS: results are mapped with searchScore
- PASS: results sort by searchScore before sortDate
- PASS: landmark boost exists

## Failures

- None

No build was run. No trade JSON was modified.
