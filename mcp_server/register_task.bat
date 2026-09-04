@echo off
REM Install or update the FlowVeo MCP watchdog scheduled task.
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_watchdog.ps1"
if errorlevel 1 (
  echo [ERROR] Watchdog task registration failed.
  exit /b 1
)

echo.
echo Watchdog installed and started.
echo Use: start_mcp_manager.bat status ^| start ^| stop ^| restart
