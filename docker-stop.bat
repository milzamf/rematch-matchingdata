@echo off
title Stop RE-MATCH Docker Stack
color 0C

echo ===================================================
echo             STOPPING RE-MATCH DOCKER              
echo ===================================================
echo.

cd /d "%~dp0"
docker compose down

echo.
echo [OK] Seluruh container RE-MATCH telah dihentikan.
timeout /t 3 >nul
