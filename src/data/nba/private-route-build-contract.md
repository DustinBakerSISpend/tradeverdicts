# NBA Phase 2Q guarded private route creation and local build

Phase 2Q may create exactly seven Astro route-source files under `src/pages/nba/`
and one private rendering shell under `src/lib/nba/`.

A local build must produce exactly 123 NBA HTML pages and 434 internal NBA links.
Every rendered page must be private, noindex, nofollow, publication-ineligible,
and ad-free. Approved aliases remain search-only and do not create duplicate URLs.

Existing `dist` output must be backed up and restored after the audit.

No remote branch, push, Netlify preview, or production deployment is authorized.
The NBA branch must remain local with no upstream.
