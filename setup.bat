@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo Kontekstno setup
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Installing Node.js LTS...

  where winget >nul 2>nul
  if errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference='Stop';" ^
      "$index=Invoke-RestMethod 'https://nodejs.org/dist/index.json';" ^
      "$lts=$index | Where-Object { $_.lts -ne $false } | Select-Object -First 1;" ^
      "$version=$lts.version;" ^
      "$url='https://nodejs.org/dist/' + $version + '/node-' + $version + '-x64.msi';" ^
      "$out=Join-Path $env:TEMP 'nodejs-lts-x64.msi';" ^
      "Invoke-WebRequest -Uri $url -OutFile $out;" ^
      "Start-Process msiexec.exe -ArgumentList '/i', $out, '/qn', '/norestart' -Wait;"
  ) else (
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  )

  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js installation failed or PATH was not updated.
  echo Close this window, open a new terminal, and run setup.bat again.
  pause
  exit /b 1
)

echo Node version:
node --version
echo.

call :install_deps "services\ai-service"
call :install_deps "services\backend"
call :install_deps "services\frontend"

echo.
echo Setup finished. Dependencies are installed.
echo Starting project in hidden windows...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~dp0start.bat' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
echo Project start requested.
endlocal
exit /b 0

:install_deps
set "SERVICE_DIR=%~1"
if not exist "%SERVICE_DIR%\package.json" exit /b 0

echo Installing dependencies in %SERVICE_DIR%...
pushd "%SERVICE_DIR%"
call npm install
if errorlevel 1 (
  popd
  echo npm install failed in %SERVICE_DIR%
  pause
  exit /b 1
)
popd

exit /b 0
