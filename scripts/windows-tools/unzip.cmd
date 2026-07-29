@echo off
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0unzip.ps1" %*
exit /b %ERRORLEVEL%
