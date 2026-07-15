# TradeVerdicts Working Rules

## Safety and Git
- Inspect before editing.
- Use PowerShell syntax for shell commands.
- Never use git add .
- Stage files only by explicit path.
- Do not stage, commit, push, deploy, delete files, or modify Git history unless explicitly instructed.
- Do not touch unrelated tracked files.
- Do not stage untracked reports, scripts, backups, or temporary files unless explicitly instructed.
- Preserve existing untracked files.
- Show the exact changed files and a concise diff summary before stopping.

## Builds
- The production build is slow and should be avoided until a deliberate endpoint.
- Do not run npm run build unless explicitly instructed.
- Do not push unless explicitly instructed.
- Prefer narrow inspections and audits before broad validation.

## NFL Trade Data
- The primary NFL source is src/data/nfl/trades.json.
- Preserve all valid factual downstream pick-provenance chains.
- A team receives evaluative credit only for:
  - a player it directly acquired;
  - a player it drafted while holding the pick;
  - or compensation it actually received when moving the pick onward.
- A terminal player selected by a later holder must not influence the original team’s grade or verdict.
- Distinguish factual downstream history from evaluative ownership.
- Do not delete accurate downstream facts merely because they cannot support the original team’s grade.
- Do not guess unknown assets or compensation.
- Preserve non-target trades and fields exactly during scoped repairs.

## Repair Workflow
- Work on one bounded batch at a time.
- Inspect and classify before applying changes.
- Read-only scripts must prove the source remained unchanged.
- Apply scripts must use exact guards, a timestamped backup, temporary-file writing, reread validation, non-target preservation checks, automatic restoration on failure, and git diff --check.
- Do not claim success until command output proves success.
- Separate findings, proposals, approved changes, and unresolved research.
- Stop after completing and validating the requested scope.

## Current Checkpoint
- Global provenance batch G001 is complete, built, committed, and pushed.
- G001 commit: 19b0965adaec53ebfcfdf9c30242e8ff1ece96b8.
- G001 source SHA-256: e2688f414f89de4891facc0d1b81eac0f4dd6644f7bbc37943bff9e94e4ba203.
- The next global repair batch is G002.
- Nine global repair batches remain: G002 through G010.
- Do not reopen the completed 54-batch general NFL cleanup.
- Do not reopen completed provenance batches unless a new audit proves a specific defect.
