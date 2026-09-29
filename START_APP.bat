@echo off
setlocal enabledelayedexpansion
title ALPHA.bet 2026 Competition Server
cls
echo =========================================================
echo      ALPHA.BET 2026 COMPETITION SYSTEM
echo      Student-Owned 20-Question Grid Architecture
echo =========================================================

:: Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js (https://nodejs.org) to run this application.
    pause
    exit /b
)

:: Detect Local LAN IP Address
set "LOCAL_IP=localhost"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "temp_ip=%%a"
    set "temp_ip=!temp_ip: =!"
    if not "!temp_ip!"=="127.0.0.1" (
        set "LOCAL_IP=!temp_ip!"
    )
)

echo.
echo Application Panels Ready:
echo   Hub Launcher:     http://localhost:3001
echo   Student Panel:    http://localhost:3001/student
echo   Teacher Control:  http://localhost:3001/control
echo   Display / OBS:    http://localhost:3001/display
echo   3-in-1 Simulator: http://localhost:3001/split
echo.
echo Network Access (Tablets/Phones/Other PCs):
echo   Student Panel:    http://%LOCAL_IP%:3001/student
echo   Teacher Control:  http://%LOCAL_IP%:3001/control
echo   Display / OBS:    http://%LOCAL_IP%:3001/display
echo =========================================================
echo.

node server/index.js
pause
