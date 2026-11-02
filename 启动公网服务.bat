@echo off
chcp 65001 >nul 2>&1
title C3 Quiz - Public Server

cd /d "%~dp0"

echo ================================================
echo   C3 Quiz - Start Public Server
echo ================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo Install Node.js 18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

where ssh >nul 2>&1
if errorlevel 1 (
    echo [ERROR] SSH client not found.
    echo Windows 10/11 usually has ssh built in.
    echo Or enable it in Settings - Apps - Optional Features.
    echo.
    pause
    exit /b 1
)

python start_public.py

echo.
pause
