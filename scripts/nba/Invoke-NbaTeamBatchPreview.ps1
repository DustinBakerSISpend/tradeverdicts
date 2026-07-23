[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')]
    [string]$BatchId,

    [string]$DecisionsPath = '',

    [string]$SourceLabel = 'User-provided NBA legacy team-table batch',

    [string]$OutputRoot = 'C:\Users\dusti\Documents\TradeVerdicts-Backups'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'C:\Users\dusti\tradeverdicts-nba'
$ExpectedBranch = 'nba-import'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$OutputDir = Join-Path $OutputRoot "NBA-Team-Batch-$BatchId-Preview-$Stamp"

function Invoke-GitReadOnly {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    Push-Location -LiteralPath $Repo
    $OldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        [object[]]$Output = @(& git @Arguments 2>&1)
        $ExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $OldPreference
        Pop-Location
    }

    $Text = [string]::Join(
        [Environment]::NewLine,
        [string[]]@($Output | ForEach-Object { [string]$_ })
    ).Trim()

    if ($ExitCode -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')`n$Text"
    }

    return $Text
}

if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
    throw "Private NBA worktree is missing: $Repo"
}

$ResolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$CurrentBranch = Invoke-GitReadOnly @(
    'symbolic-ref', '--quiet', '--short', 'HEAD'
)

if ($CurrentBranch -ne $ExpectedBranch) {
    throw "Expected branch '$ExpectedBranch'; current branch is '$CurrentBranch'."
}

$Status = Invoke-GitReadOnly @(
    'status', '--porcelain=v1', '--untracked-files=all'
)

if (-not [string]::IsNullOrWhiteSpace($Status)) {
    throw "Private NBA worktree is not clean:`n$Status"
}

$Upstream = Invoke-GitReadOnly @(
    'for-each-ref', '--format=%(upstream:short)', "refs/heads/$ExpectedBranch"
)

if (-not [string]::IsNullOrWhiteSpace($Upstream)) {
    throw "Privacy guard failed: '$ExpectedBranch' has upstream '$Upstream'."
}

if (-not (Test-Path -LiteralPath $OutputRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
}

$Arguments = @(
    'scripts/nba/run-team-batch-preview.mjs',
    '--input', $ResolvedInput,
    '--batch-id', $BatchId,
    '--output-dir', $OutputDir,
    '--source-label', $SourceLabel
)

if (-not [string]::IsNullOrWhiteSpace($DecisionsPath)) {
    $ResolvedDecisions = (Resolve-Path -LiteralPath $DecisionsPath).Path
    $Arguments += @('--decisions', $ResolvedDecisions)
}

Push-Location -LiteralPath $Repo
try {
    & node @Arguments
    $ExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($ExitCode -ne 0) {
    throw "Generic NBA team-batch preview failed with exit code $ExitCode."
}

$StatusAfter = Invoke-GitReadOnly @(
    'status', '--porcelain=v1', '--untracked-files=all'
)

if (-not [string]::IsNullOrWhiteSpace($StatusAfter)) {
    throw "Repository changed during preview:`n$StatusAfter"
}

Write-Host "`nGENERIC TEAM-BATCH PREVIEW PASSED" -ForegroundColor Green
Write-Host "Output directory: $OutputDir"
Write-Host 'No repository write, canonical import, build, route, push, or deployment occurred.' -ForegroundColor Green
