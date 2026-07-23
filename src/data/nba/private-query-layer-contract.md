# NBA Phase 2O private query-layer contract

Status: private read-only retrieval

## Purpose

Phase 2O adds deterministic in-memory indexes and query functions for the committed NBA trade and player stores.

Supported private lookups include:

- trade by canonical source Trade ID or slug;
- trades by team identity;
- trades by date;
- player by canonical name or approved alias;
- trades linked to a resolved player;
- players linked to a canonical trade.

## Result behavior

Exact player identities must resolve uniquely or return `not_found`. No fuzzy merge is performed.

Partial player search may return `ambiguous` with all matching candidates. It may not silently choose one.

Unknown dates, teams, source Trade IDs, and player identities return safe zero-result objects.

## Shared perspectives

The Rui Hachimura and Deandre Ayton Lakers/Wizards records must each resolve as one canonical trade with two source perspectives.

## Privacy and safety

All returned records remain private, manual-review, noindex, ad-free, and not publication-ready.

Phase 2O may create library, test, and external preview files only. It may not modify `trades.json` or `players.json`, create web routes, run Astro, push, or deploy.
