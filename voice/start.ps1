$ErrorActionPreference = 'Stop'
$version = '1.13.11'
$runtime = Join-Path $PSScriptRoot '.runtime'
$executable = Join-Path $runtime 'livekit-server.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    New-Item -ItemType Directory -Force $runtime | Out-Null
    $archiveName = "livekit_${version}_windows_amd64.zip"
    $baseUrl = "https://github.com/livekit/livekit/releases/download/v$version"
    $archive = Join-Path $runtime $archiveName
    Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $archive
    $checksumPath = Join-Path $runtime 'checksums.txt'
    Invoke-WebRequest "$baseUrl/checksums.txt" -OutFile $checksumPath
    $checksums = Get-Content -LiteralPath $checksumPath -Raw
    $expected = ($checksums -split "`n" | Where-Object { $_.Trim().EndsWith($archiveName) }) -split '\s+'
    if (-not $expected -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected[0]) {
        throw 'LiveKit download checksum did not match.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
}
& $executable --config (Join-Path $PSScriptRoot 'livekit.dev.yaml')
