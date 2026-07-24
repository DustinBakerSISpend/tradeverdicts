# NBA scalable private exposure-isolation contract

The exposure audit compares the built `/nba/` HTML set with the current data-driven private route models. It must not assume the original 27 trades, 67 players, 123 NBA pages, or 434 NBA links.

For every guarded local build:

- the built NBA files must exactly equal the current modeled NBA paths;
- modeled and rendered NBA internal-link totals must agree;
- missing files, unexpected files, broken links, privacy failures, ad markers, and publication markers must remain zero;
- every NBA page must remain private, noindex/nofollow, publication-ineligible, and ad-free;
- generated sitemaps may contain no `/nba/` URL;
- no public non-NBA HTML page may link into `/nba/`.

The audit is local only. No push, preview deployment, or production deployment is authorized.
