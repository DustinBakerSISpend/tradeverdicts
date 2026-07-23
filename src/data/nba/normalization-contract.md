# NBA normalization and candidate-matching contract

Status: Phase 2C foundation  
Writes/imports: disabled

## Purpose

Convert validated team-perspective submissions into deterministic normalized review records. Normalization does not create or merge canonical trades.

## Conservative parsing

The normalizer may classify explicit asset language, but it must preserve the original display text and may not invent:

- player identities
- pick protections
- pick conveyance outcomes
- original-team ownership
- asset direction in ambiguous multi-team trades
- transaction dates
- canonical matches

Unclear assets remain `other` or receive warnings.

## Candidate matching

Candidate scores are review aids only. Automatic merging remains disabled.

Signals:

- explicitly linked known trade ID
- exact trade date
- exact canonical team set
- overlapping structured asset identities
- conservative summary-token similarity

Outputs:

- `exact-match-candidate`
- `likely-match-candidate`
- `ambiguous-candidate`
- `new-transaction-candidate`

No category authorizes a merge by itself.
