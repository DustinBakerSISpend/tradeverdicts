# NBA private route-model contract

Status: scalable private presentation models

## Purpose

The route-model layer converts the validated private query index into deterministic NBA root, section-index, trade, player, and represented-team models. Counts are derived from the committed stores and represented-team index rather than the original pilot size.

## Link policy

Trade models link to represented teams and actively referenced players. Player models link to active canonical trades. Team models link to canonical trades. Section indexes link to every canonical detail model. Approved aliases remain search-only and never create duplicate routes.

Every modeled link must resolve to another modeled `/nba/` path. Team and player links must be bidirectional with their trade links.

## Privacy policy

Every model remains private and local-only, noindex/nofollow, ad-free, sitemap-excluded, navigation-excluded, and not publication-ready. A model may exist locally without authorizing public route exposure.

## Dynamic invariants

The expected model total is four indexes plus the trade count, player count, and represented-team count. Expected internal links are derived from index links plus twice the team memberships and twice the active player references. Duplicate paths, broken links, namespace escapes, self-links, privacy failures, and incomplete models must remain zero.
