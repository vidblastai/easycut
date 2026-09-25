@echo off
setlocal enabledelayedexpansion
title EasyCut

rem  EasyCut, on Windows, by double-click.
rem
rem  The same thing start.sh does on a Mac or Linux box, for people who do not
rem  have a bash. Downloads the code if it is missing, installs, starts the app
rem  and opens the browser. Safe to run again - it skips whatever is done.
rem
rem  Deliberately no PowerShell: a .cmd runs on a double-click with no execution
rem  policy to argue with, which is the whole point of this file existing.

echo.
echo   EasyCut
echo   =======
echo.

rem ---------------------------------------------------------------- node ----
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, and nothing here works without it.
  echo.
  echo   Opening nodejs.org - click the big LTS button, install it with all
  echo   the defaults, then run this file again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=* usebackq" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 20 (
  echo   Node !NODE_MAJOR! is too old - this needs 20 or newer.
  echo   Opening nodejs.org. Install the LTS version and run this again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
echo   [ok] Node !NODE_MAJOR!

rem ----------------------------------------------------------------- git ----
where git >nul 2>nul
if errorlevel 1 (
  echo   Git is not installed, so the code cannot be downloaded.
  echo.
  echo   Opening git-scm.com - install it with all the defaults, then run
  echo   this file again.
  start "" https://git-scm.com/download/win
  pause
  exit /b 1
)
echo   [ok] Git

rem ---------------------------------------------------------------- code ----
rem  Next to this file if it was run from inside a clone; otherwise in the
rem  home folder, which is somewhere a person can find again.
set REPO=%~dp0
if not exist "%REPO%package.json" set REPO=%USERPROFILE%\easycut\

if not exist "%REPO%package.json" (
  echo.
  echo   Downloading EasyCut into %USERPROFILE%\easycut
  git clone https://github.com/vidblastai/easycut "%USERPROFILE%\easycut"
  if errorlevel 1 (
    echo.
    echo   The download failed. Are you online? Is the repository private to
    echo   an account this machine is not signed in to?
    pause
    exit /b 1
  )
)

cd /d "%REPO%"
if errorlevel 1 (
  echo   Could not open %REPO%
  pause
  exit /b 1
)

echo.
echo   Getting the latest version
git fetch origin --quiet
git checkout claude/easycut-ai-video-editor-cnpana --quiet
git pull --quiet
echo   [ok] Code is up to date

rem --------------------------------------------------------------- setup ----
echo.
echo   Installing. The first time this takes a few minutes - it is fetching
echo   the caption typefaces, the sound effects and the music beds.
echo.
call npm run setup
if errorlevel 1 (
  echo.
  echo   Setup failed. Copy the red text above and send it to Claude.
  pause
  exit /b 1
)

rem ---------------------------------------------------------------- keys ----
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo   Made a .env file for your API keys. It works without them - you just
  echo   get no captions until DEEPGRAM_API_KEY is filled in.
)

rem ----------------------------------------------------------------- run ----
echo.
echo   Starting. Give it about twenty seconds.
echo   The browser opens by itself; if it does not, go to:
echo.
echo       http://localhost:3000
echo.
echo   Leave this window open - closing it stops the app.
echo.

rem  A plain delay rather than polling the health endpoint, on purpose: the
rem  polling version needs nested quotes inside `start`, which is the single
rem  most fragile thing you can write in a .cmd file. Twenty seconds of waiting
rem  beats a clever line that might not parse on somebody else's Windows.
start "EasyCut" /min cmd /c "timeout /t 20 /nobreak >nul && start http://localhost:3000"

call npm run dev

echo.
echo   EasyCut has stopped.
pause
