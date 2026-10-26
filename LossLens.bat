@echo off
rem Double-click to start the LossLens presentation app.
cd /d "%~dp0"
title LossLens
echo Starting LossLens... (close this window to stop it)
python app\server.py
if errorlevel 1 (
    echo.
    echo Something went wrong. Is Python installed? Try:  python --version
    pause
)
