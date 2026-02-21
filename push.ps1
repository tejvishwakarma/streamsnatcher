# StreamSnatcher - Push to GitHub
# Run: .\push.ps1 "your commit message"

param(
    [Parameter(Position = 0)]
    [string]$Message = "Update StreamSnatcher"
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  StreamSnatcher - Git Push" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is initialized
if (-not (Test-Path ".git")) {
    Write-Host "[!] No git repo found. Initializing..." -ForegroundColor Yellow
    git init

    $remote = Read-Host "Enter your GitHub repo URL"
    git remote add origin $remote
    Write-Host "[OK] Remote added: $remote" -ForegroundColor Green
}

# Check if remote exists
$remoteUrl = git remote get-url origin 2>$null
if (-not $remoteUrl) {
    $remote = Read-Host "No remote found. Enter GitHub repo URL"
    git remote add origin $remote
}

Write-Host "[1/4] Staging all changes..." -ForegroundColor Yellow
git add -A

Write-Host "[2/4] Committing: $Message" -ForegroundColor Yellow
git commit -m "$Message"

# Check current branch
$branch = git branch --show-current 2>$null
if (-not $branch) {
    $branch = "main"
    git checkout -b main
}

Write-Host "[3/4] Pushing to origin/$branch..." -ForegroundColor Yellow
git push -u origin $branch

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[OK] Pushed successfully!" -ForegroundColor Green
    Write-Host "[OK] Auto-deploy will update the server shortly." -ForegroundColor Green
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "[FAIL] Push failed. Check errors above." -ForegroundColor Red
    Write-Host "  Try: git push -u origin main --force" -ForegroundColor Yellow
    Write-Host ""
}
