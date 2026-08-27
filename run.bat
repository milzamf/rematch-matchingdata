@echo off
title RE-MATCH Launcher
color 0A
setlocal enabledelayedexpansion

echo ===================================================
echo             RE-MATCH STARTUP LAUNCHER             
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Launch Laragon if not running
echo [1/4] Memeriksa Laragon...
tasklist /FI "IMAGENAME eq laragon.exe" 2>NUL | find /I /N "laragon.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] Laragon sudah berjalan.
) else (
    if exist "D:\laragon\laragon.exe" (
        echo [INFO] Menjalankan Laragon dari D:\laragon...
        start "" "D:\laragon\laragon.exe"
    ) else if exist "C:\laragon\laragon.exe" (
        echo [INFO] Menjalankan Laragon dari C:\laragon...
        start "" "C:\laragon\laragon.exe"
    ) else (
        echo [WARN] Executable Laragon tidak ditemukan di direktori default.
    )
)

:: 2. Launch Meilisearch
echo.
echo [2/4] Menjalankan Meilisearch Engine...
set "MEILI_EXE="
if exist "D:\laragon\bin\meilisearch\meilisearch.exe" (
    set "MEILI_EXE=D:\laragon\bin\meilisearch\meilisearch.exe"
) else if exist "C:\laragon\bin\meilisearch\meilisearch.exe" (
    set "MEILI_EXE=C:\laragon\bin\meilisearch\meilisearch.exe"
) else (
    where meilisearch >nul 2>nul
    if "%ERRORLEVEL%"=="0" set "MEILI_EXE=meilisearch"
)

if defined MEILI_EXE (
    start "Meilisearch - RE-MATCH (Port 7700)" cmd /k "title Meilisearch (Port 7700) && "%MEILI_EXE%" --db-path "%~dp0data.ms""
    echo [OK] Meilisearch berhasil dijalankan di jendela terpisah.
) else (
    echo [ERROR] File meilisearch.exe tidak ditemukan di direktori Laragon bin.
)

:: 3. Launch Backend (Laravel)
echo.
echo [3/4] Menjalankan Backend Laravel (Port 8000)...
start "Backend - RE-MATCH (Port 8000)" cmd /k "title Backend Laravel (Port 8000) && cd /d "%~dp0backend" && php artisan serve --port=8000"
echo [OK] Backend server berhasil dijalankan di jendela terpisah.

:: 4. Launch Frontend (Vite / TanStack Start)
echo.
echo [4/4] Menjalankan Frontend Dev Server...
start "Frontend - RE-MATCH" cmd /k "title Frontend Dev Server && cd /d "%~dp0" && npm run dev"
echo [OK] Frontend berhasil dijalankan di jendela terpisah.

:: 5. Info & Open Browser
echo.
echo ===================================================
echo   Semua service telah aktif!
echo   - Laragon:     Aktif (Web & DB)
echo   - Meilisearch: http://127.0.0.1:7700
echo   - Backend API: http://127.0.0.1:8000
echo   - Frontend:    http://localhost:8080
echo ===================================================
echo.
echo Membuka browser dalam 4 detik...
timeout /t 4 /nobreak >nul
start http://localhost:8080

echo Selesai. Anda dapat menutup jendela launcher ini.
timeout /t 5 >nul
