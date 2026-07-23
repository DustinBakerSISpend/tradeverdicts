# NBA Phase 2L player-candidate preview contract

Status: dry run only  
Canonical store: read-only  
Player store: read-only

## Inputs

Phase 2L reads the committed 27-record canonical store created in Phase 2K and the Phase 2K import receipt.

The canonical store must remain byte-identical with SHA-256:

`6EF5F01C8472792A9291A045CCADCE37C677B0DA8204C76C7966484F935D72AA`

The player store must remain the empty JSON array with SHA-256:

`37517E5F3DC66819F61F5A7BB8ACE1921282415F10551D2DEFA5C3EB0985B570`

## Identity-reference scope

The preview includes every player identity carried by the canonical records:

- 70 direct player-asset references;
- 14 draft-rights references;
- 6 conveyed-pick outcome references.

This produces 90 references grouped into 67 exact player candidates.

Draft-outcome references are included so players named as realized pick outcomes are not orphaned from future entity pages.

## Matching policy

Only exact canonical names and explicitly approved source aliases may be grouped.

Fuzzy matching, external-ID matching, and automatic player merging are disabled.

The candidate file records aliases without modifying canonical trade assets.

## Visibility

All player candidates remain:

- private;
- manual-review;
- noindex;
- ad-free;
- not publication-ready;
- not imported.

## Prohibited actions

Phase 2L may not modify `trades.json` or `players.json`, create routes, run an Astro build, push, or deploy.
