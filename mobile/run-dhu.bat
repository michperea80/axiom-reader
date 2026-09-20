@echo off
title Android Auto Desktop Head Unit
echo ========================================================
echo   AXIOM Reader - Android Auto Desktop Head Unit (DHU)
echo ========================================================
echo.
echo Before starting:
echo  1. Ensure your phone is connected via USB.
echo  2. In Android Auto settings on your phone:
echo     - Tap "Version" 10 times to unlock Developer settings (if not already done).
echo     - Tap the 3-dot menu in the top right.
echo     - Tap "Start head unit server".
echo.
echo Setting up ADB port forwarding (5277)...
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" forward tcp:5277 tcp:5277
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to set up port forward. Is your phone connected?
    pause
    exit /b %ERRORLEVEL%
)

echo Port 5277 forwarded successfully.
echo.
echo Starting Desktop Head Unit emulator...
cd /d "%LOCALAPPDATA%\Android\Sdk\extras\google\auto"
start "" desktop-head-unit.exe
echo DHU launched! You can close this window.
