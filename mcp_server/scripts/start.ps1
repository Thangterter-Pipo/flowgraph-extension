#Requires -Version 5.1
param([string]$Host = "127.0.0.1", [int]$Port = 3080, [switch]$Public)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv"

if (-not (Test-Path $venv)) {
    Write-Host "[ERROR] .venv not found. Run .\scripts\install.ps1 first" -ForegroundColor Red
    exit 1
}

$py = if ($IsWindows) { Join-Path $venv "Scripts\python.exe" } else { Join-Path $venv "bin\python" }

Write-Host "Starting Computer MCP server..."
Write-Host "  Host: $Host"
Write-Host "  Port: $Port"
if ($Public) {
    Write-Host "  Mode: PUBLIC (0.0.0.0 - use with OAuth or behind a tunnel)" -ForegroundColor Yellow
}

$env:MCP_HOST = if ($Public) { "0.0.0.0" } else { $Host }
$env:MCP_PORT = "$Port"

Push-Location $root
try {
    & $py run.py
} finally {
    Pop-Location
}