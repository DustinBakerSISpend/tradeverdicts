# Cleveland Cavaliers Phase 8G Contract

## Purpose

Phase 8G freezes the final Cleveland Cavaliers private import partition after
Phase 8F produced 150 ready packages, zero identity-held packages, zero
ambiguous identity occurrences, and zero unsafe identity occurrences.

## Frozen import partition

- Source rows: 204
- Final ready packages: 150
- Remaining identity-held packages: 0
- Prior held records preserved: 44
- Linked exclusions preserved: 10
- Proposed private player shells: 238
- Relationship previews: 446

## Evidence lineage

The 150 ready packages, 238 shell proposals, and 446 relationship previews are
resolved from the hash-identified arrays inside the exact Phase 8F freeze. The
44 prior held records and 10 linked exclusions are resolved from the exact
adjacent Phase 8F CSV artifacts that Phase 8F emitted for those partitions.
Their source bytes, parsed records, counts, and deterministic replay must agree.

## Rules

1. The exact Phase 8F checkpoint, report, bundle, record hashes, committed
   files, input-held CSV, and excluded-followups CSV must be verified before
   Phase 8G can run.
2. The final ready-package, held-record, exclusion, player-shell, and
   relationship partitions must remain stable under deterministic replay.
3. All 44 prior held records and all 10 linked exclusions remain outside the
   import partition.
4. No fuzzy identity matching, automatic identity merge, automatic canonical
   merge, or automatic route is permitted.
5. Phase 8G writes only its builder, tester, and this contract to the
   repository.
6. No canonical store, player store, team registry, relationship, route,
   publication, push, or deployment write is authorized.
7. Phase 8H is the first phase permitted to attempt guarded private store
   writes, and only from the exact Phase 8G partition.
