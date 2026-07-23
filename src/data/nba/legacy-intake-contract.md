# Legacy team-table intake contract

TradeVerdicts NBA accepts the same raw handoff style previously used for the NFL build.

Each transaction is one five-column tab-delimited record:

1. Trade date (`YYYY-MM-DD`)
2. Source-team label
3. Assets received by the source team
4. Assets sent by the source team
5. Relationship note (`trade with ...`, `3-team trade with ...`, etc.)

Asset cells may contain newline-separated bullets. The adapter preserves the original text and computes a SHA-256 hash for every raw row.

## Guardrails

- The raw source file is immutable evidence.
- A fused bullet is split but always reported as a warning.
- Slash-separated player names are preserved as aliases.
- Unknown pick outcomes, protections, counterparties, and source teams remain unresolved.
- Multi-team asset destinations remain null unless the source text identifies them.
- Missing grades, verdicts, and neutral summaries are expected at raw-intake time.
- No legacy row becomes a canonical trade automatically.
- No automatic merge is permitted.
- Pilot previews do not write to `trades.json` or `players.json`.
