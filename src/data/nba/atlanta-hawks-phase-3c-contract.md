# Atlanta Hawks Phase 3C Contract

Phase 3C is a private, read-only preview of player identity matching, relationship edges, and asset routing for the reviewed Atlanta batch.

## Hard prohibitions

- No canonical trade import.
- No player import.
- No relationship import.
- No route creation.
- No automatic player merge.
- No automatic multi-team asset routing.
- No push, preview deploy, or production deploy.

## Duplicate and identity safeguards

1. Every source player reference receives a deterministic reference key.
2. Existing player names and aliases are indexed by normalized identity.
3. A source identity may match at most one existing player record.
4. New player IDs and slugs must be unique within the Atlanta preview.
5. Placeholder values such as future considerations, PTBNL, and generic draft-pick text are excluded from the player plan and reported as parser blockers.
6. Same-name records spanning distant eras are held for manual homonym review.
7. The existing Trae Young canonical perspective is not allowed to create duplicate canonical assets or relationships.

## Routing safeguards

1. Two-team assets retain deterministic from-team and to-team routes.
2. Multi-team assets remain manual-routing holds unless a unique existing canonical asset supplies the route.
3. No partner route is inferred merely from team membership or source direction.
4. Every route endpoint must belong to the transaction team set.
5. Ambiguous or unmatched existing-canonical asset comparisons remain blocked.

All generated records remain private, noindex, ad-free, and publication-blocked.
