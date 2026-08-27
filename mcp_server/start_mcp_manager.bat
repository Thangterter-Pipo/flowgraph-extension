@echo off
REM Manage the FlowVeo MCP daemon (start / stop / status).
setlocal
cd /d "%~dp0"
set "PYTHON=%~dp0.venv\Scripts\python.exe"
set "SCRIPT=%~dp0start_mcp.py"

if /i "%~1"=="status" goto status
if /i "%~1"=="start"  goto start
if /i "%~1"=="stop"   goto stop
echo Usage:  %~nx0  status ^| start ^| stop
exit /b 1

:status
"%PYTHON%" "%SCRIPT%" status
exit /b 0

:start
echo Starting FlowVeo MCP daemon ...
"%PYTHON%" "%SCRIPT%"
timeout /t 5 /nobreak >nul
"%PYTHON%" "%SCRIPT%" status
exit /b 0

:stop
echo Stopping FlowVeo MCP daemon ...
"%PYTHON%" "%SCRIPT%" stop
timeout /t 2 /nobreak >nul
"%PYTHON%" "%SCRIPT%" status
exit /b 0