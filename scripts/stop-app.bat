@echo off
chcp 65001 >nul
REM Double-click: stop the running bet-stats stack (web :3000, API :3001, worker).
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-lifecycle.ps1" -Action Stop %*
if errorlevel 1 pause
