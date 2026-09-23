@echo off
title RE-MATCH Docker Stack Launcher
color 0A
setlocal enabledelayedexpansion

echo ===================================================
echo           RE-MATCH FULL DOCKER LAUNCHER           
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/3] Memeriksa status Docker Daemon...
docker info >nul 2>&1
if "%ERRORLEVEL%" NEQ "0" (
    echo [ERROR] Docker Desktop belum berjalan. Silakan buka Docker Desktop terlebih dahulu.
    pause
    exit /b 1
)
echo [OK] Docker siap.

echo.
echo [2/3] Membangun dan menjalankan container RE-MATCH...
docker compose up -d --build

if "%ERRORLEVEL%" NEQ "0" (
    echo [ERROR] Gagal menjalankan container.
    pause
    exit /b 1
)

echo.
echo [3/3] Menunggu database dan backend siap...
timeout /t 5 /nobreak >nul

echo.
echo ===================================================
echo   Container RE-MATCH Berhasil Dijalankan:
echo   1. Database MySQL : Port 3306 (db)
echo   2. Meilisearch    : http://localhost:7700
echo   3. Laravel API    : http://localhost:8000
echo   4. Queue Worker   : Aktif di background
echo   5. Frontend App   : http://localhost:8090
echo ===================================================
echo.
echo Membuka aplikasi di browser...
start http://localhost:8090

echo.
echo Tips: Untuk menjalankan migrasi pertama kali, jalankan:
echo docker-migrate.bat atau docker compose exec backend php artisan migrate --seed
echo.
pause
