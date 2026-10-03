<#
.SYNOPSIS
  Create the GitHub repository for this app (if needed), push main, and turn on GitHub Pages.

.PREREQS
  - GitHub CLI installed:  winget install --id GitHub.cli -e
  - Signed in once:        gh auth login
  - Run from the project folder.

.EXAMPLE
  .\publish.ps1                 # public repo "bread-app"
  .\publish.ps1 -Repo my-bread  # different repo name
#>
param(
  [string]$Repo = "bread-app",
  [switch]$Private
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "GitHub CLI (gh) not found. Install it with: winget install --id GitHub.cli -e"
}
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Not signed in. Run: gh auth login" }

$user = gh api user -q .login
Write-Host "GitHub user: $user"

if (-not (Test-Path .git)) { git init -b main | Out-Null }
if (-not (git log -1 2>$null)) { git add -A; git commit -m "Initial commit" | Out-Null }

$hasOrigin = $false
try { git remote get-url origin 2>$null | Out-Null; $hasOrigin = ($LASTEXITCODE -eq 0) } catch {}

if (-not $hasOrigin) {
  $vis = if ($Private) { "--private" } else { "--public" }
  Write-Host "Creating repo $user/$Repo ..."
  gh repo create $Repo $vis --source . --remote origin --push --description "Bread recipe scaler and bake journal (installable web app)"
} else {
  Write-Host "Pushing to existing origin ..."
  git push -u origin main
}

# Enable GitHub Pages from the main branch root (POST creates, PUT updates).
Write-Host "Enabling GitHub Pages ..."
$ok = $false
try {
  gh api -X POST "repos/$user/$Repo/pages" -f "source[branch]=main" -f "source[path]=/" 2>$null | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
} catch {}
if (-not $ok) {
  gh api -X PUT "repos/$user/$Repo/pages" -f "source[branch]=main" -f "source[path]=/" | Out-Null
}
# Pages site URL as the repo homepage (shows up on the repo page).
gh repo edit "$user/$Repo" --homepage "https://$user.github.io/$Repo/" | Out-Null

Write-Host ""
Write-Host "Done. The app will be live in about a minute at:" -ForegroundColor Green
Write-Host "  https://$user.github.io/$Repo/" -ForegroundColor Green
Write-Host "Open that link on your phone and add it to the home screen."
