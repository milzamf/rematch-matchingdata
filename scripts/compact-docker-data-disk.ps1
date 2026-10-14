param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$diskRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Docker/wsl/disk'))
$diskPath = [IO.Path]::GetFullPath((Join-Path $diskRoot 'docker_data.vhdx'))
if (-not $diskPath.StartsWith($diskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unexpected Docker disk path.'
}
$disk = Get-Item -LiteralPath $diskPath
if ($disk.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked disk file.' }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
@{ target = $diskPath; before_bytes = $disk.Length; administrator = $admin; apply = $Apply.IsPresent } | ConvertTo-Json
if (-not $Apply) { return }
if (-not $admin) { throw 'An elevated Windows PowerShell session is required.' }

Push-Location $repoRoot
$restoreDocker = $false
try {
    $expectedContainers = @('rematch-db', 'rematch-backend', 'rematch-queue-worker', 'rematch-meilisearch', 'rematch-frontend')
    $running = @(& docker ps --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw 'Docker must be running before maintenance.' }
    if (@($running | Where-Object { $_ -notin $expectedContainers }).Count -gt 0) { throw 'Unrelated containers are running; refusing a Desktop-wide stop.' }
    & docker compose exec -T backend php scripts/verify_retained_matching_data.php
    if ($LASTEXITCODE -ne 0) { throw 'Retained-data verification failed.' }
    $queued = & docker compose exec -T backend php artisan tinker --execute="echo DB::table('jobs')->count();"
    if ($LASTEXITCODE -ne 0 -or ($queued -join '').Trim() -ne '0') { throw 'Queue must be empty.' }

    Write-Host 'Returning only unused filesystem blocks to the Docker virtual disk.'
    & wsl --distribution docker-desktop --user root -- fstrim -v /mnt/docker-desktop-disk
    if ($LASTEXITCODE -ne 0) { throw 'Docker filesystem TRIM failed; nothing has been stopped.' }
    $restoreDocker = $true
    Write-Host 'Stopping RE-MATCH containers gracefully; allowing MySQL to flush.'
    & docker compose stop --timeout 600
    if ($LASTEXITCODE -ne 0) { throw 'Container shutdown failed.' }
    & docker desktop stop --timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop did not stop.' }
    & wsl --terminate docker-desktop
    if ($LASTEXITCODE -ne 0) { throw 'Docker WSL did not stop.' }

    # An exclusive read fails if another process still has this disk open.
    $probe = [IO.File]::Open($diskPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    $probe.Dispose()
    $maintenanceRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'backend/storage/app/maintenance'))
    [IO.Directory]::CreateDirectory($maintenanceRoot) | Out-Null
    $commandPath = Join-Path $maintenanceRoot ('compact-vhd-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    # Only the named, detached disk is selected. No attach, format, delete, or resize.
    $commands = "select vdisk file=`"$diskPath`"`r`ndetail vdisk`r`ncompact vdisk`r`nexit`r`n"
    [IO.File]::WriteAllText($commandPath, $commands, [Text.Encoding]::ASCII)
    Write-Host "Compacting detached Docker disk: $diskPath"
    & diskpart.exe /s $commandPath
    if ($LASTEXITCODE -ne 0) { throw 'DiskPart compaction failed.' }
    $after = (Get-Item -LiteralPath $diskPath).Length
    @{ before_bytes = $disk.Length; after_bytes = $after; reclaimed_bytes = $disk.Length - $after } | ConvertTo-Json
} finally {
    if ($restoreDocker) {
        Write-Host 'Restoring Docker Desktop and RE-MATCH containers.'
        & docker desktop start --timeout 180
        if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop restart failed; run docker desktop start.' }
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            try {
                & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            } catch {
                # Startup can briefly report a missing engine pipe.
            }
            Start-Sleep -Seconds 2
        }
        if (-not $ready) { throw 'Docker engine did not become ready.' }
        # Recreate changed service definitions so approved MySQL flags persist.
        & docker compose up -d --wait --wait-timeout 180
        if ($LASTEXITCODE -ne 0) { throw 'RE-MATCH restart failed; run docker compose up -d.' }
    }
    Pop-Location
}
