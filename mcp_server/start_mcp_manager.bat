@echo off
REM Manage the FlowVeo MCP watchdog (start / stop / restart / status).
setlocal
cd /d "%~dp0"
set "PYTHON=%~dp0.venv\Scripts\python.exe"
set "SCRIPT=%~dp0start_mcp.py"
set "TASK=FlowVeo MCP"

if /i "%~1"=="status"  goto status
if /i "%~1"=="start"   goto start
if /i "%~1"=="stop"    goto stop
if /i "%~1"=="restart" goto restart
echo Usage: %~nx0 status ^| start ^| stop ^| restart
exit /b 1

:status
"%PYTHON%" "%SCRIPT%" status
schtasks /query /tn "%TASK%" /fo LIST 2>nul | findstr /i /c:"Status:" /c:"Last Result:"
exit /b 0

:start
schtasks /run /tn "%TASK%" >nul 2>&1
if errorlevel 1 (
  start "" /b "%~dp0.venv\Scripts\pythonw.exe" "%SCRIPT%"
)
timeout /t 3 /nobreak >nul
"%PYTHON%" "%SCRIPT%" status
exit /b 0

:stop
"%PYTHON%" "%SCRIPT%" stop
exit /b 0

:restart
"%PYTHON%" "%SCRIPT%" stop
timeout /t 2 /nobreak >nul
schtasks /run /tn "%TASK%" >nul 2>&1
if errorlevel 1 (
  start "" /b "%~dp0.venv\Scripts\pythonw.exe" "%SCRIPT%"
)
timeout /t 3 /nobreak >nul
"%PYTHON%" "%SCRIPT%" status
exit /b 0
