$fresh = "E:\Flow_veo\chrome-profile-fresh"
if (-Not (Test-Path $fresh)) {
  New-Item -ItemType Directory -Path $fresh | Out-Null
}
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$ext = "E:\Flow_veo\flowgraph-extension\dist"
$args = @(
  "--remote-debugging-port=9226",
  "--user-data-dir=$fresh",
  "--load-extension=$ext",
  "--no-first-run",
  "--no-default-browser-check",
  "https://labs.google/fx/tools/flow"
)
Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Hidden
Start-Sleep -Seconds 10
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:9226/json/list" -UseBasicParsing -TimeoutSec 8
  "PORT 9226: $($r.StatusCode)"
  ($r.Content | ConvertFrom-Json) | Where-Object { $_.type -in @('page', 'service_worker') } | ForEach-Object {
    "$($_.type) | $($_.title) | $($_.url)"
  }
} catch {
  "PORT 9226 FAIL: $($_.Exception.Message)"
}
