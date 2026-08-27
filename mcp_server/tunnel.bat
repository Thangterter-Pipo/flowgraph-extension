@echo off
REM Start the Flow_veo MCP server + expose it publicly via an SSH reverse
REM tunnel through the Contabo VPS (alias `contabo` in ~/.ssh/config).
REM
REM Result: the server is reachable from anywhere at:
REM     http://194.163.174.78:3080/mcp        (with Authorization: Bearer <key>)
REM
REM Requires:
REM   1. An SSH alias `contabo` that works without a password prompt
REM      (key-based auth already set up).
REM   2. On the VPS: GatewayPorts yes already configured (one-time setup).
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] .venv not found. Run:  uv venv ^&^& uv pip install -r requirements.txt
  exit /b 1
)

REM 1) Start the MCP server in a new window (keeps logs separate).
start "FlowVeo MCP server" cmd /k ".venv\Scripts\python.exe run.py"

REM 2) Give the server a moment to bind 0.0.0.0:3080.
timeout /t 3 /nobreak >nul

REM 3) Open the SSH reverse tunnel. The VPS forwards 0.0.0.0:3080 -> local 127.0.0.1:3080.
REM    ServerAliveInterval keeps the tunnel alive through NAT; ExitOnForwardFailure
REM    aborts if the VPS cannot bind the port (e.g. it is already in use).
REM    Press Ctrl+C to stop the tunnel (the server keeps running).
ssh -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -N -R 0.0.0.0:3080:127.0.0.1:3080 contabo
