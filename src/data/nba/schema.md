# TradeVerdicts NBA data contract

Status: approved foundation contract  
League: NBA  
Default visibility: private, noindex, ad-free

## Canonical principle

The canonical record is the transaction. A team submission is immutable source evidence and a team perspective. Multiple submissions may resolve to one canonical transaction only after a reviewed match decision.

## Canonical trade fields

Required:

- `id`
- `league` (`nba`)
- `slug`
- `tradeDate`
- `seasonLabel`
- `teams`
- `sourceTeams`
- `assetsReceived`
- `summary`
- `verdict`
- `grades`
- `perspectives`
- `sources`
- `canonicalKey`
- `dateTeamsKey`
- `publishStatus`
- `reviewStatus`
- `indexEligible`
- `adEligible`
- `createdAt`
- `updatedAt`

## Initial asset types

- `player`
- `draft_pick`
- `pick_swap`
- `draft_rights`
- `cash`
- `trade_exception`
- `conditional_asset`
- `future_consideration`
- `other`

Unknown details must be preserved as unknown. The importer must not invent dates, protections, teams, player identities, pick outcomes, or transaction certainty.

## Source submission fields

- `submissionId`
- `batchId`
- `sourceTeam`
- `sourceRowId`
- `sourceFileName`
- `sourceLabel`
- `receivedAt`
- `rawText`
- `rawFields`
- `contentHash`

## Merge policy

Automatic canonical merging is disabled during the initial NBA build. Matching produces review candidates only:

- exact-match candidate
- likely-match candidate
- ambiguous candidate
- new-transaction candidate

A reviewed decision must authorize a merge.

## Route and monetization policy

This foundation creates no routes. Eventual NBA pages will live under `/nba/`. Until final integration approval, every NBA record remains private, excluded from public sitemaps, noindex, and ad-free.
