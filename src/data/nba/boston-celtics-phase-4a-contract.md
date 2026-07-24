# Boston Celtics Phase 4A Reviewed Intake Contract

## Starting checkpoint

`ca002b0f05594e06547c70d86b35e7dec07819bb`

## Reviewed inputs

- Final workbook SHA-256: `948B5067B1013C4395036579D12571C06D814531A097894A292AACAFE4BA2F2D`
- Original uploaded raw source SHA-256: `92C638A8F0F9EDFD93780A4A171EF7CE9D9E879728D75A079932BFEC95BD94EE`
- Normalized repository snapshot SHA-256: `77F6F20F44737F4C3114AE41526DEC063F1F18DF556479A7D775989DD54A03DE`
- Source rows: 223
- Two-team rows: 205
- Multi-team rows: 18
- Partner references: 244
- Date-aware defunct partner references: 19
- New-canonical candidate flags: 197
- Atlanta lineage-overlap candidates: 14
- Exact Atlanta reviewed-row matches expected in preview: 13
- Unmatched lineage candidate expected: `BOS-1949-0016`
- Non-standalone merge/exclude rows: 12
- Insufficient-evidence rows: 3

## Source normalization

The repository snapshot uses UTF-8 with LF line endings, no trailing spaces, and exactly one final newline. The original upload hash is retained in metadata.

## Date normalization

All 223 workbook date serials are normalized to strict `YYYY-MM-DD` strings before the reviewed batch is embedded. The first and final dates are guarded as `1946-12-12` and `2026-07-06`. All 244 partner references are then recomputed against the date-aware lineage resolver so later Bullets and 2005 Hornets records cannot inherit the wrong historical franchise.

## Historical resolution additions

This phase adds five defunct franchises:

- Pittsburgh Ironmen
- Toronto Huskies
- Providence Steamrollers
- Indianapolis Olympians
- Denver Nuggets (1948–1950)

It also makes `Nuggets` and `Hornets` date-aware and strips legacy `(BAA)` / `(NBL)` suffixes before historical resolution.

## Safety

This phase is reviewed intake and preview only.

- Canonical store writes: 0
- Player store writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic merges: 0
- Publication authorization: no
- Push: no
- Preview deployment: no
- Production deployment: no

Potential matches against the existing canonical store and the completed Atlanta reviewed batch are surfaced externally for the next duplicate-safe phase. They are not merged automatically.
