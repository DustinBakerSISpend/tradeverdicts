# Charlotte Hornets Phase 6F Player-Shell and Relationship Freeze

## Frozen inputs
- Starting checkpoint: `6346e706fd14c66fc41efe7cdabeeb4bfb0c8659`
- Phase 6E eligibility-record SHA-256: `6D3D7A1C44F590141CDCD699AFF9580237451E97CBAB4045385A5140E78AE840`
- Phase 6E dependency-seed SHA-256: `B600782468CC703EB89DE5C7620E0AB37793CD5DEA868C130333085C370EA286`
- Phase 6E freeze-record SHA-256: `62E4A25911E9472DA2D4E7BE0B6F2AEBA48968E48F9D39C8B4896916BA33BD56`

## Scope
Phase 6F evaluates player-like dependency seeds for the 103 Phase 6E eligible
trade packages.

Each player-like dependency may become:
1. an exact existing-player reference;
2. a deterministic proposed player shell;
3. an ambiguous dependency hold; or
4. a non-player contract/mechanism reference.

A package is ready only when every player-like dependency is either an exact
existing-player reference or a proposed shell. Ambiguous dependencies hold the
entire package.

## Identity rules
- Exact matching uses normalized names and explicit alias fields.
- Multiple exact candidates are ambiguous.
- Composite or unparseable player strings are ambiguous.
- Proposed shells are previews only.
- No fuzzy, semantic, or automatic player merge is allowed.

## Safety
- Canonical imports: 0
- Player imports: 0
- Relationship writes: 0
- Route-data writes: 0
- Canonical IDs assigned: 0
- Automatic identity resolutions: 0
- Automatic merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
