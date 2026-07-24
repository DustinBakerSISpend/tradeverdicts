# NBA private query-layer contract

Status: private read-only retrieval, scalable stores

## Purpose

The private query layer builds deterministic in-memory indexes for the committed NBA trade and player stores. Expected counts are derived from the stores rather than frozen to the original 27-trade / 67-player pilot.

Supported private lookups include trade ID or slug, team, date, player identity or approved alias, player-linked trades, and trade-linked players.

## Identity behavior

Exact player identities must resolve uniquely or return `not_found`. Partial searches may return `ambiguous`; no fuzzy or automatic merge is allowed. Unknown inputs return safe zero-result objects.

Imported identity shells may temporarily have zero active trade references while their frozen links await the corresponding canonical import. They remain valid private records when explicitly marked with a nonempty review status.

## Required invariants

- store record counts equal indexed record counts;
- team memberships equal the sum of canonical trade team sets;
- active player references equal the committed `sourceReferences`;
- exact normalized identities remain unambiguous;
- invalid references, extra references, duplicate reference ownership, and unknown trade teams remain zero;
- every trade and player remains private, noindex, ad-free, and not publication-ready.

The layer performs no repository writes, route creation, push, or deployment.
