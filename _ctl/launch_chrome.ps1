$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$args = @(
  "--remote-debugging-port=9224",
  "--user-data-dir=E:\Flow_veo\chrome-profile",
  "--load-extension=E:\Flow_veo\flowgraph-extension\dist",
  "--no-first-run",
  "--no-default-browser-check",
  "https://labs.google/fx/tools/flow"
)
Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Hidden
Start-Sleep -Seconds 8
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:9224/json/list" -UseBasicParsing -TimeoutSec 5
  "STATUS $($r.StatusCode)"
  $j = $r.Content | ConvertFrom-Json
  $j | Where-Object { $_.type -in @('page','service_worker') } | ForEach-Object { "$($_.type) | $($_.title) | $($_.url)" }
} catch { "FAIL $($_.Exception.Message)" }
