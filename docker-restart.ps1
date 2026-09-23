# RE-MATCH Docker Restart Script for PowerShell
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "          RE-MATCH DOCKER RESTART SCRIPT           " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

Write-Host "[1/4] Memeriksa status Docker Daemon..." -ForegroundColor Yellow
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker Desktop belum berjalan. Silakan buka Docker Desktop terlebih dahulu." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Docker daemon aktif." -ForegroundColor Green

Write-Host "`n[2/4] Menghentikan container yang sedang berjalan..." -ForegroundColor Yellow
docker compose down

Write-Host "`n[3/4] Membangun ulang dan menyalakan seluruh container..." -ForegroundColor Yellow
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Gagal menyalakan container." -ForegroundColor Red
    exit 1
}

Write-Host "`n[4/4] Memeriksa status container..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
docker compose ps

Write-Host "`n===================================================" -ForegroundColor Green
Write-Host "  Container RE-MATCH Berhasil Di-restart!" -ForegroundColor Green
Write-Host "  - Frontend App   : http://localhost:8080" -ForegroundColor White
Write-Host "  - Laravel API    : http://localhost:8000" -ForegroundColor White
Write-Host "  - Meilisearch    : http://localhost:7700" -ForegroundColor White
Write-Host "  - Database MySQL : Port 3306" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Green

Start-Process "http://localhost:8080"
