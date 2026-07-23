# NBA pick and swap normalization contract

Status: Phase 2E review contract  
Canonical import status: disabled

## Draft-pick years

A pick may have several different year concepts:

- `draftYear`: the best single display year. If the pick has conveyed, this is the conveyed year; otherwise it is the leading declared year.
- `declaredDraftYear`: a year explicitly declared at the beginning of the asset.
- `possibleDraftYears`: all scheduled or option years mentioned in the source.
- `conveyedYear`: the year attached to a known final draft outcome.
- `overall` and `becamePlayerName`: the final known selection, when supplied.

The normalizer must not replace a known conveyed year with an earlier protection or option year.

## Draft-pick rounds

- A leading declared round takes precedence over round words inside conditions.
- `possibleRounds` preserves multiple possible conveyance rounds.
- A conditional asset such as “first round protected, else second round” may have `round: null` and `possibleRounds: [1, 2]`.
- A declared “conditional second round pick” remains Round 2 even when its trigger references a first-round pick.

## Conditionality

A pick is conditional when its text includes a conditional declaration, an `if`/`else` path, an option year, or more/less-favorable selection language.

## Pick swaps

A source team table may repeat the same swap option in both received and sent columns. The raw representations must remain intact, but the derived normalization must consolidate them into one `pick_swap_contract` object with:

- `holderTeam`
- `subjectTeam`
- `draftYear`
- `round`
- `exerciseStatus`
- `sourceRepresentations`

A repeated source representation is not a second canonical asset.

## Review decisions

Pilot-specific repairs must live in a transparent decision file. The raw source file remains immutable. Provisional decisions and unresolved source questions must remain blocked from canonical import.
