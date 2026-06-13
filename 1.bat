@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 > nul

set "ROOT=%~dp0"
set "VERSION_FILE=%ROOT%release-version.txt"

if not exist "%VERSION_FILE%" (
  >"%VERSION_FILE%" echo 0
)

set "CURRENT_VERSION=0"
set /p CURRENT_VERSION=<"%VERSION_FILE%"
if not defined CURRENT_VERSION set "CURRENT_VERSION=0"

for /f "delims=0123456789" %%A in ("%CURRENT_VERSION%") do set "CURRENT_VERSION=0"
set /a NEXT_VERSION=CURRENT_VERSION+1

> "%VERSION_FILE%" echo !NEXT_VERSION!

echo.
echo ================================
echo   RELEASE UPDATE !NEXT_VERSION!
echo ================================
echo.

git add -A -- . ":(exclude).logs" ":(exclude).dev-logs" ":(exclude)services/backend/prisma/dev.db" ":(exclude)services/backend/prisma/dev.db-journal"
git commit -m "release update !NEXT_VERSION!"
if errorlevel 1 (
  echo Commit skipped or failed.
  exit /b 1
)

git tag -a -f "v!NEXT_VERSION!" -m "Release v!NEXT_VERSION!"
if errorlevel 1 (
  echo Tag creation failed.
  exit /b 1
)

git push origin main --follow-tags
if errorlevel 1 (
  echo Branch push failed.
  exit /b 1
)

git push origin "v!NEXT_VERSION!" --force
if errorlevel 1 (
  echo Tag push failed.
  exit /b 1
)

echo.
echo ================================
echo   RELEASE PUBLISHED AS v!NEXT_VERSION!
echo ================================
echo.
pause
