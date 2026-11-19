@echo off
setlocal
cd /d "%~dp0"
title SPECCA_SYNTH
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install it from https://nodejs.org/.
    pause
    exit /b 1
)
node server.js --open
if errorlevel 1 (
    pause
    exit /b 1
)
