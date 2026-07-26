# Charlotte Hornets Phase 6H Guarded Private Import

## Frozen starting point

- Starting checkpoint: `b4380d40ab4d76211615c77dd1744d9e8417f7ce`
- Phase 6G final-package SHA-256: `8C48F5FB5AEB70FA5E48F03B506FAF4A6FDC193C7105B86FFB0383BBC2B24EAD`
- Phase 6G ready-player-shell SHA-256: `8A206B94A6B954C4EF45D00C4A45C09384C036D6089658FCECE59465822B3DBC`
- Phase 6G ready-relationship SHA-256: `F63EA0997C95FD97269D52D308C9BC88D293FE468CFE95482C849E39350E3CE6`
- Phase 6G import-partition SHA-256: `6C4B637177089823CD6F2C9C0DE9D5162EAFEB98BB347133F63B631FA7ED55C8`

## Import partition

- Ready canonical-create packages: 102
- Held packages: 1
- Perspective appends: 0
- Ready player shells: 113
- Ready relationship previews: 199

The held package and its unresolved dependency remain untouched.

## Store preimage contract

The mutable stores must match the exact Phase 6G checkpoint tree before any
write occurs. Their LF-normalized SHA-256 values are then derived locally and
passed to the importer as immutable preimages.

Receipt-level store digests are not file hashes and are never used as file
preimage guards.

## Expected private import

- Canonical trades created: 102
- Player shells created: 113
- Relationship references added: 199
- Post-import canonical trades: 759
- Post-import players: 1,292
- Historical team registrations: determined from the frozen ready package set

## Privacy

Every imported trade, perspective, player shell, asset, relationship reference,
and any newly registered historical team remains private, noindex, ad-free,
and not publication-ready.

## Safety

- Automatic identity merges: 0
- Automatic canonical merges: 0
- Automatic routes: 0
- Held-package imports: 0
- Push: no
- Preview deployment: no
- Production deployment: no
