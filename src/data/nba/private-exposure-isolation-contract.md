# NBA Phase 2R exposure isolation and private-pilot freeze

Phase 2R is the final technical isolation gate for the private Washington Wizards pilot.

A clean local production build must continue to produce exactly 12,033 HTML pages,
including exactly 123 private NBA pages and 434 internal NBA links.

The generated sitemap set may contain no `/nba/` URL. No public non-NBA HTML page
may link to `/nba/`. All 123 NBA pages must remain private, noindex, nofollow,
publication-ineligible, and ad-free.

The existing Astro sitemap filter is audited but not modified in this phase.

After a passing build and exposure audit, Phase 2R commits only its audit tooling
and contract, creates a verified local recovery bundle, and writes an external
freeze manifest containing hashes for the committed NBA pilot namespaces.

The `nba-import` branch remains local with no upstream. No push, Netlify preview,
or production deployment is authorized.
