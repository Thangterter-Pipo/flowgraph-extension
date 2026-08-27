#Requires -Version 5.1
# End-to-end test of the Computer MCP server (HTTP-level).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv"
$py = if ($IsWindows) { Join-Path $venv "Scripts\python.exe" } else { Join-Path $venv "bin\python" }

Write-Host "=== Computer MCP E2E Test ===" -ForegroundColor Cyan

# Run the python E2E test (it starts its own TestClient against the app)
Push-Location $root
try {
    & $py test_e2e.py 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "E2E (HTTP): PASSED" -ForegroundColor Green
    } else {
        Write-Host "E2E (HTTP): FAILED" -ForegroundColor Red
        exit 1
    }

    # Also run unit suites
    & $py test_local.py 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "Filesystem tests: PASSED" -ForegroundColor Green }
    else { Write-Host "Filesystem tests: FAILED" -ForegroundColor Red; exit 1 }

    & $py test_extended.py 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "Extended tests: PASSED" -ForegroundColor Green }
    else { Write-Host "Extended tests: FAILED" -ForegroundColor Red; exit 1 }

    & $py test_exec.py 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "Exec tests: PASSED" -ForegroundColor Green }
    else { Write-Host "Exec tests: FAILED" -ForegroundColor Red; exit 1 }
} finally {
    Pop-Location
}

Write-Host "`nALL MCP TESTS PASSED" -ForegroundColor Green