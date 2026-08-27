#Requires -Version 5.1
param([switch]$SkipDeps)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== Computer MCP Installer ===" -ForegroundColor Cyan
Write-Host "Root: $root"

# 1. Check Python
$python = Get-Command "python" -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "[ERROR] Python not found. Install Python 3.12+ from https://python.org" -ForegroundColor Red
    exit 1
}
$ver = & $python.Source --version
Write-Host "Python: $ver"

# 2. Create venv
$venv = Join-Path $root ".venv"
if (-not (Test-Path $venv)) {
    Write-Host "Creating virtual environment..."
    & $python.Source -m venv $venv
}
$pip = if ($IsWindows) { Join-Path $venv "Scripts\pip.exe" } else { Join-Path $venv "bin\pip" }
if (-not $SkipDeps) {
    Write-Host "Installing dependencies..."
    & $pip install fastmcp uvicorn python-dotenv websockets 2>&1 | Out-Null
}

# 3. Copy .env if missing
$envFile = Join-Path $root ".env"
$envExample = Join-Path $root ".env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Copy-Item $envExample $envFile
    Write-Host "Created .env from .env.example - edit FLOW_VEO_MCP_API_KEY" -ForegroundColor Yellow
}
if (-not (Test-Path $envFile)) {
    @"
MCP_HOST=127.0.0.1
MCP_PORT=3080
MCP_AUTH_MODE=none
MAX_FILE_READ_MB=50
MAX_COMMAND_OUTPUT_MB=10
COMMAND_TIMEOUT_SECONDS=120
LOG_LEVEL=INFO
"@ | Out-File $envFile -Encoding utf8
    Write-Host "Created default .env" -ForegroundColor Yellow
}

# 4. Test import
Write-Host "Testing MCP server import..."
$pythonw = if ($IsWindows) { Join-Path $venv "Scripts\python.exe" } else { Join-Path $venv "bin\python" }
$ok = & $pythonw -c "import server; print('OK')" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Server import: OK" -ForegroundColor Green
} else {
    Write-Host "Server import FAILED: $ok" -ForegroundColor Red
    exit 1
}

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host "Start: .\scripts\start.ps1"
Write-Host "Endpoint: http://127.0.0.1:3080/mcp"