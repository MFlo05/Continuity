<#
.SYNOPSIS
    Cut a new release of Continuity so BRAT can pick it up on mobile.

.DESCRIPTION
    BRAT installs from GitHub *Releases*, not from the repo's files. Pushing a
    commit alone will never reach your phone. This script does the whole loop:

        bump version -> production build -> commit -> push -> GitHub Release

    BRAT requires the release tag, the release title, and the "version" field
    inside the released manifest.json to all match. This script keeps them in
    sync so you can't get that wrong.

.EXAMPLE
    .\release.ps1 0.1.2

.EXAMPLE
    .\release.ps1 0.2.0 -Notes "Adds the recipe vault widget"
#>
[CmdletBinding()]
param(
    # Semver, no leading "v" -- BRAT matches this against manifest.json.
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$')]
    [string]$Version,

    [string]$Notes = ""
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- Preflight -----------------------------------------------------------
Step "Preflight checks"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) not found. Install it with: winget install GitHub.cli"
}

git rev-parse --git-dir > $null
if (-not $?) { throw "Not a git repository." }

if (-not (git remote)) {
    throw "No git remote configured. Run: git remote add origin <your repo URL>"
}

# Refuse to reuse a tag -- BRAT keys off tags, and a duplicate silently
# leaves your phone on the old build.
git fetch --tags --quiet
$existing = git tag --list $Version
if ($existing) {
    throw "Tag '$Version' already exists. Pick a higher version number."
}

Write-Host "  gh, git remote, and tag availability OK" -ForegroundColor Green

# --- Bump version --------------------------------------------------------
Step "Bumping version to $Version"

foreach ($file in @('manifest.json', 'package.json')) {
    $raw = Get-Content $file -Raw
    # Test for a match rather than for a change: re-releasing the version the
    # file already carries is legitimate (it's how the first release works),
    # and a value-unchanged rewrite must not read as "field not found".
    $rx = [regex]'("version"\s*:\s*")[^"]*(")'
    if (-not $rx.IsMatch($raw)) { throw "Could not find a version field in $file" }
    # Replace only the first "version" field (top level in both files).
    $new = $rx.Replace($raw, "`${1}$Version`${2}", 1)
    # No BOM -- Obsidian's JSON parser chokes on it.
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $file), $new, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  $file -> $Version" -ForegroundColor Green
}

# --- Build ---------------------------------------------------------------
Step "Building (production, minified)"

npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed -- nothing was committed or pushed." }

foreach ($artifact in @('main.js', 'manifest.json', 'styles.css')) {
    if (-not (Test-Path $artifact)) { throw "Build artifact missing: $artifact" }
}
Write-Host ("  main.js is {0:N0} KB" -f ((Get-Item main.js).Length / 1KB)) -ForegroundColor Green

# --- Commit and push -----------------------------------------------------
Step "Committing and pushing"

git add -A
$staged = git diff --cached --name-only
if ($staged) {
    git commit -q -m "Release $Version"
    if (-not $?) { throw "Commit failed." }
} else {
    Write-Host "  Nothing changed since last commit; tagging existing HEAD." -ForegroundColor Yellow
}

git push origin HEAD
if ($LASTEXITCODE -ne 0) { throw "Push failed -- no release was created." }

# --- GitHub Release ------------------------------------------------------
Step "Creating GitHub Release $Version"

if (-not $Notes) { $Notes = "Continuity $Version" }

# Tag == title == manifest version, exactly as BRAT expects.
gh release create $Version main.js manifest.json styles.css --title $Version --notes $Notes
if ($LASTEXITCODE -ne 0) { throw "Release creation failed." }

Write-Host "`nRelease $Version published." -ForegroundColor Green
Write-Host "On your iPhone: BRAT -> 'Check for updates', then reload Obsidian.`n" -ForegroundColor Green
