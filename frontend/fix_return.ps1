$content = Get-Content src\app\pages\DashboardPage.tsx -Raw
# Fix the return statement to wrap everything in a single fragment
$content = $content -replace 'return \(\s*<>\s*\{metricCards\.map', 'return ( <> {metricCards.map'
$content = $content -replace '\)\}\s*</>\s*\{beginnerMode', ')} })() } <> {beginnerMode'
$content = $content -replace 'return \(\s*<>\s*\{metricCards\.map', 'return ( <> {metricCards.map'
Set-Content src\app\pages\DashboardPage.tsx -Value $content
Write-Host "Done"