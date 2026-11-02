@echo off
chcp 65001 >nul 2>&1
title C3 Quiz - LAN Server

cd /d "%~dp0"

echo ================================================
echo   C3 Quiz - LAN Server
echo ================================================
echo.
echo Starting server...

REM Kill old process on 8787
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found.
    echo.
    echo Install Node.js 18+ from https://nodejs.org
    echo (choose LTS, the .msi installer)
    echo.
    pause
    exit /b 1
)

start "C3-Quiz-Server" /MIN cmd /c "node server.js"

timeout /t 3 /nobreak >nul

REM Get LAN IP
echo.
echo ================================================
echo   Your LAN address (open this on your phone):
echo ================================================
powershell -NoProfile -Command "
\$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notlike '127.*' -and \$_.IPAddress -notlike '169.254*' } | Select-Object -First 1
if (\$ip) {
  Write-Output ''
  Write-Output ('    http://' + \$ip.IPAddress + ':8787')
  Write-Output ''
  Write-Output '  (phone must be on the SAME wifi)'
} else {
  Write-Output '    (could not detect IP, check ipconfig)'
}
" 2>nul

echo ================================================
echo.
echo   Health check: http://127.0.0.1:8787/api/health
echo   Stop: close this window, or run Í£Ö¹·þÎñ.bat
echo.
echo ================================================
echo.
pause
