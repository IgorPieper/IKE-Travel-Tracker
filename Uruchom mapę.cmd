@echo off
cd /d "%~dp0"
if exist "Tracker Wyjazdow.exe" (
    start "" "Tracker Wyjazdow.exe"
    exit /b
)
where python >nul 2>nul
if errorlevel 1 (
    py -3 uruchom.py
) else (
    python uruchom.py
)
if errorlevel 1 pause
