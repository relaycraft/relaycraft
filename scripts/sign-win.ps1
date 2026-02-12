# RelayCraft Windows Local Signing Script
# Usage: .\scripts\sign-win.ps1 -CertPath "C:\path\to\your\cert.p12" -CertPassword "your-password"

param (
    [Parameter(Mandatory=$false)]
    [string]$ArtifactsDir = "all-bundles",

    [Parameter(Mandatory=$false)]
    [string]$CertPath,

    [Parameter(Mandatory=$false)]
    [string]$CertPassword,

    [Parameter(Mandatory=$false)]
    [string]$Thumbprint,

    [Parameter(Mandatory=$false)]
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

if (-not $Thumbprint -and (-not $CertPath -or -not $CertPassword)) {
    Write-Error "You must provide either a -Thumbprint OR both -CertPath and -CertPassword."
}

# Ensure tools are available
if (!(Get-Command signtool -ErrorAction SilentlyContinue)) {
    Write-Error "signtool not found. Please ensure Windows SDK is installed and signtool is in your PATH."
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm not found. Please ensure Node.js and pnpm are installed."
}

# 1. Sign binaries with signtool (MSI and EXE)
# Note: signtool modifies the files, so we do this BEFORE Tauri signature generation.
Write-Host "`n--- Step 1: Signing binaries with SignTool ---" -ForegroundColor Cyan
Get-ChildItem -Path $ArtifactsDir -Include *.exe, *.msi -Recurse | ForEach-Object {
    Write-Host "Signing: $($_.Name)..."
    if ($Thumbprint) {
        & signtool sign /v /fd sha256 /sha1 $Thumbprint /tr $TimestampUrl /td sha256 $_.FullName
    } else {
        & signtool sign /f $CertPath /p $CertPassword /tr $TimestampUrl /td sha256 /fd sha256 $_.FullName
    }
}

# 2. Generate Tauri signatures
# This requires TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD to be in the environment!
Write-Host "`n--- Step 2: Generating Tauri Updater Signatures ---" -ForegroundColor Cyan
if (!($env:TAURI_SIGNING_PRIVATE_KEY)) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY environment variable is missing!"
    Write-Host "Please set your Tauri private key before running this script."
    Write-Host "Example: `$env:TAURI_SIGNING_PRIVATE_KEY = '...'`"
}
if (!($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY_PASSWORD environment variable is missing (if required)."
}

Get-ChildItem -Path $ArtifactsDir -Include *.exe, *.msi, *.zip -Recurse | ForEach-Object {
    if ($_.Name -match "\.sig$") { return } # Skip existing .sig files
    
    # We only sign the bundles used by the updater
    if ($_.Name -match "\.(msi|exe|zip)$") {
        Write-Host "Generating signature for: $($_.Name)..."
        # Using npx to ensure we use the local tauri cli
        pnpm tauri signer sign -w "$($_.FullName)" | Out-File -FilePath "$($_.FullName).sig" -NoNewline -Encoding utf8
    }
}

# 3. Update/Generate latest.json
Write-Host "`n--- Step 3: Updating latest.json ---" -ForegroundColor Cyan
$packageJson = Get-Content "package.json" | ConvertFrom-Json
$version = $packageJson.version

node scripts/generate-update-json.cjs $ArtifactsDir $version

Write-Host "`n✅ Done! Artifacts in '$ArtifactsDir' are signed and ready for upload." -ForegroundColor Green
Write-Host "Please remember to manually upload the signed files and latest.json to your GitHub Release."
