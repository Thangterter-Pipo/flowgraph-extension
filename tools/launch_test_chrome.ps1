$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profile = "E:\Flow_veo\chrome-profile"
$ext = "E:\Flow_veo\flowgraph-extension\dist"

$args = @(
  "--remote-debugging-port=9224",
  "--remote-allow-origins=*",
  "--user-data-dir=$profile",
  "--load-extension=$ext",
  "--no-first-run",
  "--no-default-browser-check"
)

Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Hidden
Write-Output "Chrome launched with remote-allow-origins. Waiting for CDP..."
Start-Sleep -Seconds 8
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:9224/json/list" -UseBasicParsing -TimeoutSec 5
  Write-Output "CDP_OK: $($r.StatusCode)"
  $j = $r.Content | ConvertFrom-Json
  Write-Output "TABS: $($j.Count)"
} catch {
  Write-Output "CDP_FAIL: $($_.Exception.Message)"
}
