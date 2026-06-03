Set-Location -LiteralPath "C:\Users\user\Downloads\StockIntel\backend"
$env:DOTENV_CONFIG_PATH = "C:\Users\user\Downloads\StockIntel\backend\.env"
$p = Start-Process -NoNewWindow -FilePath "node" -ArgumentList "index.js" -RedirectStandardOutput "C:\Users\user\Downloads\StockIntel\backend\stdout.log" -RedirectStandardError "C:\Users\user\Downloads\StockIntel\backend\stderr.log" -PassThru
$p.Id | Out-File "C:\Users\user\Downloads\StockIntel\backend\pid.txt"
Wait-Process -Id $p.Id -Timeout 300
