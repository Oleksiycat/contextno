@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 > nul

set "ROOT=%~dp0"
set "VERSION_FILE=%ROOT%release-version.txt"
set "REMOTE_ZIP_URL=https://github.com/Oleksiycat/contextno/archive/refs/heads/main.zip"
set "TEMP_BASE=%TEMP%\contextno-update"
set "TEMP_ZIP=%TEMP_BASE%.zip"
set "TEMP_EXTRACT=%TEMP_BASE%-extract"
set "TEMP_ENV=%TEMP_BASE%-env"

if not exist "%ROOT%.git" (
  call :update_from_github_zip
  exit /b %ERRORLEVEL%
)

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

git fetch origin main
if errorlevel 1 (
  echo Failed to fetch origin/main.
  exit /b 1
)

git pull --rebase --autostash origin main
if errorlevel 1 (
  echo Failed to rebase onto origin/main.
  exit /b 1
)

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

exit /b 0

:update_from_github_zip
echo.
echo ================================
echo   UPDATING FROM GITHUB ZIP
echo ================================
echo.

if exist "%TEMP_EXTRACT%" rmdir /s /q "%TEMP_EXTRACT%"
del /f /q "%TEMP_ZIP%" >nul 2>nul
del /f /q "%TEMP_ENV%" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$zip='%TEMP_ZIP%';" ^
  "$extract='%TEMP_EXTRACT%';" ^
  "Invoke-WebRequest -Uri '%REMOTE_ZIP_URL%' -OutFile $zip;" ^
  "Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force;"
if errorlevel 1 (
  echo Failed to download or extract the GitHub ZIP.
  exit /b 1
)

set "SOURCE_DIR=%TEMP_EXTRACT%\contextno-main"
if not exist "%SOURCE_DIR%" (
  echo Extracted archive root was not found.
  exit /b 1
)

if exist "%ROOT%.env" copy /Y "%ROOT%.env" "%TEMP_ENV%" >nul

robocopy "%SOURCE_DIR%" "%ROOT%" /MIR /XD ".git" ".logs" ".dev-logs" ".tmp" "node_modules" /XF ".env" "dev.db" "dev.db-journal" "dev.db-shm" "dev.db-wal"
set "ROBOCOPY_EXIT=%ERRORLEVEL%"
if %ROBOCOPY_EXIT% GEQ 8 (
  echo Failed to sync files from the GitHub ZIP.
  if exist "%TEMP_ENV%" copy /Y "%TEMP_ENV%" "%ROOT%.env" >nul
  exit /b 1
)

if exist "%TEMP_ENV%" copy /Y "%TEMP_ENV%" "%ROOT%.env" >nul

if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%" >nul 2>nul
if exist "%TEMP_EXTRACT%" rmdir /s /q "%TEMP_EXTRACT%"
if exist "%TEMP_ENV%" del /f /q "%TEMP_ENV%" >nul 2>nul

echo.
echo ================================
echo   GITHUB ZIP UPDATED
echo ================================
echo.
pause
exit /b 0
