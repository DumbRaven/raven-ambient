@echo off
cd /d "%~dp0"
call npm.cmd run desktop
if errorlevel 1 pause
