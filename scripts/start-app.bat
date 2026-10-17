@echo off
chcp 65001 >nul
REM Double-click launcher: starts the full stack and opens http://127.0.0.1:3000
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-lifecycle.ps1" -Action Start %*
if errorlevel 1 pause
