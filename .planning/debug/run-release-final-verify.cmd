@echo off
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
set "CI=true"
"C:\Program Files\nodejs\node.exe" "C:\Users\Vlad\AppData\Roaming\npm\node_modules\corepack\dist\pnpm.js" verify:release 1> ".planning\debug\release-final-verify.stdout.log" 2> ".planning\debug\release-final-verify.stderr.log"
set "VERIFY_EXIT=%ERRORLEVEL%"
> ".planning\debug\release-final-verify.exit.txt" echo %VERIFY_EXIT%
exit /b %VERIFY_EXIT%
