@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
 echo Project Python environment missing. See docs\python-investigator.txt.
 pause
 exit /b 1
)
".venv\Scripts\python.exe" tools\serial_probe.py
if errorlevel 1 pause
