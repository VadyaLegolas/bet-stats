$ErrorActionPreference = 'Continue'
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
$stdout = '.planning/debug/privacy-focused-20260925-020000.stdout.log'
$stderr = '.planning/debug/privacy-focused-20260925-020000.stderr.log'
$exitMarker = '.planning/debug/privacy-focused-20260925-020000.exit.txt'
& 'C:\Program Files\nodejs\corepack.cmd' pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/privacy-retention.spec.ts 1> $stdout 2> $stderr
$code = $LASTEXITCODE
Set-Content -LiteralPath $exitMarker -NoNewline -Value "EXIT_CODE=$code"
exit $code
