@echo off
chcp 65001 >nul 2>&1
title C3 Quiz - Stop

echo Stopping service on port 8787...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING 2^>nul') do (
    echo Killing PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
echo Done.
timeout /t 2 >nul
