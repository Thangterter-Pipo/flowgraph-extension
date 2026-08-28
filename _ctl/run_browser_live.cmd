@echo off
setlocal
set FLOW_RUN_LIVE_BROWSER=1
set PYTHONPATH=%~dp0..\tests
where pytest >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  pytest "%~dp0..\tests\test_live_browser.py" -m live_paid -vv -s
) else (
  python -m pytest "%~dp0..\tests\test_live_browser.py" -m live_paid -vv -s
)
endlocal
