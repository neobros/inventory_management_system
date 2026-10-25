@echo off
REM ===========================================================================
REM  StockPilot — start the till in direct-print mode
REM ===========================================================================
REM
REM  Launches Chrome with kiosk printing enabled, which makes receipts print
REM  immediately to the DEFAULT Windows printer with no print dialog.
REM
REM  Before first use:
REM    1. Install the Xprinter XP-80 driver
REM    2. Windows Settings -> Bluetooth & devices -> Printers & scanners
REM       -> XP-80 -> "Set as default"
REM       (turn OFF "Let Windows manage my default printer")
REM    3. Set POS_URL below to the address staff use
REM
REM  Use this shortcut every day. A normally-opened Chrome will still show the
REM  print dialog — that is Chrome's behaviour, not a fault in the app.
REM ===========================================================================

REM --- Change this to your address (keep http:// or https://) ---------------
set "POS_URL=http://localhost:5173"

REM --- Separate profile so kiosk printing cannot affect normal browsing -----
set "POS_PROFILE=%LOCALAPPDATA%\StockPilotPOS"

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

REM --- Fall back to Edge, which supports the same flag ----------------------
if not defined CHROME (
  if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if not defined CHROME (
  echo.
  echo   Could not find Chrome or Edge in the usual places.
  echo   Install Google Chrome, or edit this file and set CHROME to its full path.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting StockPilot till...
echo   Printer: Windows default    URL: %POS_URL%
echo.

start "" "%CHROME%" --kiosk-printing --user-data-dir="%POS_PROFILE%" --no-first-run --disable-features=Translate "%POS_URL%"

exit /b 0
