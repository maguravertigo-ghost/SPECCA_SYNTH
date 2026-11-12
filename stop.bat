@echo off
taskkill /FI "WINDOWTITLE eq MIDI Player Server*" /T /F >nul 2>nul
if errorlevel 1 (
    echo  [i] Server is not running.
) else (
    echo  [+] Server stopped.
)
pause