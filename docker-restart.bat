@echo off
title RE-MATCH Docker Stack Restarter
color 0B
setlocal enabledelayedexpansion

echo ===================================================
echo           RE-MATCH DOCKER RESTART SCRIPT           
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/4] Memeriksa status Docker Daemon...
docker info >nul 2>&1
if "%ERRORLEVEL%" NEQ "0" (
    echo [ERROR] Docker Desktop belum berjalan. Silakan buka Docker Desktop terlebih dahulu.
    pause
    exit /b 1
)
echo [OK] Docker daemon aktif.

echo.
echo [2/4] Menghentikan container yang sedang berjalan...
docker compose down

echo.
echo [3/4] Membangun ulang dan menyalakan seluruh container...
docker compose up -d --build

if "%ERRORLEVEL%" NEQ "0" (
    echo [ERROR] Gagal menyalakan container.
    pause
    exit /b 1
)

echo.
echo [4/4] Memeriksa status container...
timeout /t 3 /nobreak >nul
docker compose ps

echo.
echo ===================================================
echo   Container RE-MATCH Berhasil Di-restart!
echo   1. Database MySQL : Port 3306 (db)
echo   2. Meilisearch    : http://localhost:7700
echo   3. Laravel API    : http://localhost:8000
echo   4. Queue Worker   : Aktif di background
echo   5. Frontend App   : http://localhost:8080
echo ===================================================
echo.
echo Membuka aplikasi di browser...
start http://localhost:8080
echo.
pause
