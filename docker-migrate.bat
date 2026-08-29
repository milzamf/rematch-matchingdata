@echo off
title RE-MATCH Database Migration & Seeder
color 0B

echo ===================================================
echo       RE-MATCH DATABASE MIGRATION & SEEDING        
echo ===================================================
echo.

cd /d "%~dp0"

echo Menjalankan migrasi dan seeder di dalam container backend...
docker compose exec backend php artisan migrate --seed

echo.
if "%ERRORLEVEL%"=="0" (
    echo [SUKSES] Migrasi dan seeding database berhasil dilakukan.
) else (
    echo [GAGAL] Terjadi kesalahan saat migrasi database.
)
echo.
pause
