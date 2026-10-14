$ErrorActionPreference = 'Stop'
# Only resources created for this disposable UAT run. Never starts Docker.
docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker unavailable; no cleanup performed.' }
$uatContainers = [ordered]@{
    'rematch-uat-db' = 'd4833c39e973'
    'rematch-uat-http' = '0c42ceb35497'
    'rematch-uat-large' = '7731ad3003b4'
    'rematch-uat-copy' = 'f59e9083bd9f'
    'rematch-uat-legacy-http' = 'e728f89a7162'
}
# Validate every identity before removing anything. A reused name fails closed.
$uatExisting = @()
foreach ($uatName in $uatContainers.Keys) {
    $uatId = docker container inspect --format '{{.Id}}' $uatName 2>$null
    if ($LASTEXITCODE -eq 0) {
        if (-not $uatId.StartsWith($uatContainers[$uatName])) { throw "Container identity changed: $uatName" }
        $uatExisting += $uatName
    }
}
foreach ($uatName in $uatExisting) {
    docker container rm --force $uatName
    if ($LASTEXITCODE -ne 0) { throw "Container cleanup failed: $uatName" }
}
foreach ($uatNetwork in @('rematch-uat-http-net', 'rematch-uat-db-net')) {
    docker network inspect $uatNetwork 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        docker network rm $uatNetwork
        if ($LASTEXITCODE -ne 0) { throw "Network remains in use: $uatNetwork" }
    }
}
docker volume inspect rematch-uat-data 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    docker volume rm rematch-uat-data
    if ($LASTEXITCODE -ne 0) { throw 'UAT volume remains in use; no forced volume deletion.' }
}
