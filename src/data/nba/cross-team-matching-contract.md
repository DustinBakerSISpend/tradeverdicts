# NBA cross-team perspective matching contract

Phase 2G compares normalized team-perspective submissions before canonical import.

## Principles

- A team row is evidence about a transaction, not automatically a canonical trade.
- Match scoring uses trade date, team-set overlap, source/partner reciprocity, and reciprocal asset text.
- Exact, likely, and ambiguous results are review candidates only.
- Automatic merging is always disabled.
- A repeated transaction from a second team must retain both immutable source perspectives.
- Multi-team rows may remain unresolved until enough team perspectives or external evidence exists.

## Editorial workflow

The user supplies raw text. The system produces normalized grading-source rows. ChatGPT then assigns preliminary grades, verdicts, summaries, and analysis in the Steelers-compatible TradeVerdicts schema. Meta and Grok audit that editorial workbook before canonical acceptance.
