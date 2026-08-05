@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found. Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4173/' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 }; exit 1 } catch { exit 1 }"
if errorlevel 1 (
  start "VibeCheck local server" /min cmd /c "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort > .vibecheck-dev.log 2>&1"
)

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(20); do { try { $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4173/' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } } catch {}; Start-Sleep -Milliseconds 400 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo VibeCheck did not start. See .vibecheck-dev.log for details.
  pause
  exit /b 1
)

rem Use Windows Explorer to hand the URL to the default browser. This is more
rem reliable for a double-clicked .cmd file than Start-Process inside PowerShell.
start "" explorer.exe "http://127.0.0.1:4173/"
if errorlevel 1 (
  echo VibeCheck is running at http://127.0.0.1:4173/
  echo Copy that address into a browser to continue.
  pause
  exit /b 1
)

endlocal
