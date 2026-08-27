@echo off
REM Start the Flow_veo MCP server on 0.0.0.0:3080 (LAN + Cloudflare tunnel).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] .venv not found. Run:  uv venv ^&^& uv pip install -r requirements.txt
  exit /b 1
)
".venv\Scripts\python.exe" run.py
