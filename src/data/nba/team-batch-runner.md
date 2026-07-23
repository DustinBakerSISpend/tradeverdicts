# Generic NBA team-batch preview runner

Phase 2F converts the Lakers pilot tooling into a reusable dry-run command for any NBA team file that uses the approved five-column legacy format:

1. trade date
2. source-team label
3. assets received
4. assets sent
5. relationship note

## User workflow

The user supplies the raw team trade text without converting it to JSON or manually normalizing aliases, picks, swaps, rights, cash, or exceptions.

A batch receives a lowercase hyphenated ID such as `celtics-batch-001`. The generic runner creates an external artifact directory containing:

- an exact raw-source snapshot
- a normalized JSON preview
- a review-queue CSV
- a text summary
- a SHA-256 manifest

## Safety contract

The generic runner:

- requires the private `nba-import` branch to be clean
- writes output outside the repository
- does not change `trades.json` or `players.json`
- does not perform canonical merges or imports
- does not create routes
- does not run Astro or a production build
- does not push or deploy

## PowerShell usage

```powershell
& .\scripts\nba\Invoke-NbaTeamBatchPreview.ps1 `
  -InputPath "C:\path\to\celtics-batch-001.txt" `
  -BatchId "celtics-batch-001"
```

An optional reviewed decision file may be supplied with `-DecisionsPath`.

## Promotion policy

External preview artifacts are review evidence only. A separate guarded phase must approve and copy a raw batch into `src/data/nba/raw/` and must construct canonical records. Preview success alone never authorizes import.
