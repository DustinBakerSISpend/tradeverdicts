# Chicago Bulls Phase 7G Identity Blocker Resolution

## Purpose

Conservatively repair the 16 unsafe player-identity strings that held 14
otherwise eligible Chicago packages in Phase 7F. The phase advances only a
package whose complete identity set becomes deterministic.

## Fixed input accounting

- Source rows: 219
- Eligible Phase 7F packages: 187
- Ready Phase 7F packages: 173
- Identity-held Phase 7F packages: 14
- Unsafe identity occurrences: 16
- Ambiguous identity occurrences: 0
- Phase 7F proposed player shells: 218
- Phase 7F relationship previews: 349
- Existing Phase 7E reconciliation holds: 25
- Linked exclusions: 7
- Existing private players: 1,292

## Conservative repair rules

The resolver may:

- extract a clearly quoted person name;
- remove brackets, parentheses and transaction prefixes;
- remove draft-number prefixes such as `2020 #7-`;
- remove explicit rights labels;
- split a composite only on clear `and`, `&`, slash or semicolon separators
  when every resulting component independently passes the person-name test.

The resolver must not:

- resolve question marks, unknown, TBD, PTBNL or player-to-be-named-later text;
- treat draft, cash, pick, role or staff terminology as a player identity;
- fuzzy-match an identity;
- merge multiple existing exact owners;
- create a player or relationship automatically.

## Final partition

- Every originally ready package remains ready.
- A held package advances only when all unsafe identities in that package are
  repaired and no ambiguity remains.
- An unresolved package stays held with the original asset text preserved.
- Final player shells and relationship previews are regenerated only for the
  final ready-package set.

## Safety

- Canonical imports: 0
- Player imports: 0
- Team-registry writes: 0
- Relationship writes: 0
- Route-data writes: 0
- Automatic player creates: 0
- Automatic identity merges: 0
- Publication authorized: no
- Push: no
- Preview deployment: no
- Production deployment: no
