# Boston Celtics Phase 4G — Final Blocker Resolution and Import Partition

## Starting checkpoint

`974ef322345636175454fffdc1e38c721c80781a`

## Purpose

Phase 4G resolves the three shared Atlanta/Boston canonical-package blockers,
applies only conservative player-identity decisions, and partitions all 211
packages into import-ready and held groups.

## Shared canonical unions

For each of the three shared packages, the fully routed Boston ledger is treated
as the transaction asset union. The Atlanta reviewed row contributes its
independent team perspective and provenance. A package is released from the
shared-union blocker only when:

- both Atlanta and Boston source teams are present;
- both reviewed perspectives are present;
- every asset has an explicit route and classified type;
- every declared team appears in the routed ledger; and
- the target canonical ID does not collide with the current store.

## Ambiguous player identities

A player identity may be resolved only when one candidate has a uniquely stronger
primary-name signal:

- one unique exact primary display-name match; or
- one unique normalized primary-name match while the other candidates match only
  through aliases.

All other identities remain manual holds. No automatic merges are authorized.

## Safety

- Canonical imports: 0
- Player imports: 0
- Perspective writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic identity merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no

Only the reusable Phase 4G builder, test, and contract are committed. Generated
resolution and partition artifacts remain in the verified backup directory.


## Count and record-key separation

The generated JSON keeps summary counts and detailed record arrays under
different keys. For example, `sharedUnionResolutions` is the numeric count,
while `sharedUnionResolutionRecords` contains the three detailed records.
This prevents a later object property from replacing its corresponding count.
