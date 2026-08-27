@echo off
title Stop RE-MATCH Services
color 0C

echo ===================================================
echo             STOPPING RE-MATCH SERVICES            
echo ===================================================
echo.

echo Menghentikan proses Meilisearch...
taskkill /F /IM meilisearch.exe 2>nul

echo Menghentikan proses PHP artisan serve...
for /f "tokens=2" %%i in ('tasklist /FI "WINDOWTITLE eq Backend Laravel*" /NH 2^>nul') do taskkill /F /PID %%i 2>nul
taskkill /F /IM php.exe /FI "WINDOWTITLE eq Backend Laravel*" 2>nul

echo Menghentikan proses Frontend dev server...
for /f "tokens=2" %%i in ('tasklist /FI "WINDOWTITLE eq Frontend Dev Server*" /NH 2^>nul') do taskkill /F /PID %%i 2>nul

echo.
echo ===================================================
echo [OK] Seluruh service RE-MATCH berhasil dihentikan.
echo ===================================================
timeout /t 3 >nul
