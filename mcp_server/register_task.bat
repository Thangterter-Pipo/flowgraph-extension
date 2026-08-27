@echo off
REM Register the FlowVeo MCP daemon as a Windows Scheduled Task.
REM The task runs at every logon, stays alive as long as the user is
REM logged in, and auto-restarts if it crashes.
REM
REM Run this ONCE from an elevated Command Prompt (Run as Administrator).
REM
REM To remove later:
REM   schtasks /delete /tn "FlowVeo MCP" /f

setlocal
cd /d "%~dp0"

set "PYTHON=%~dp0.venv\Scripts\pythonw.exe"
set "SCRIPT=%~dp0start_mcp.py"

if not exist "%PYTHON%" (
  echo [ERROR] pythonw.exe not found in .venv. Run:  uv venv ^&^& uv pip install -r requirements.txt
  exit /b 1
)

echo Registering scheduled task "FlowVeo MCP" ...
schtasks /create /tn "FlowVeo MCP" /ru "%USERNAME%" /rl HIGHEST /sc onlogon ^
  /tr "\"%PYTHON%\" \"%SCRIPT%\"" /f

echo.
echo Task created. It will run next time you log in.
echo To start it NOW without logging out, run:
echo   start_mcp_manager.bat start
echo.
echo Commands:
echo   start_mcp_manager.bat status   -- check health
echo   start_mcp_manager.bat start    -- start daemon
echo   start_mcp_manager.bat stop     -- stop daemon