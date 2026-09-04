$cdp = "http://127.0.0.1:9224/json"
$pageId = "08707765C17645AFC1D0B46C19C6D83C"
$targetUrl = "https://labs.google/fx/vi/tools/flow/project/23e7d6d8-d0bc-441b-b720-e63b0ffa9d32"

# Use the Chrome DevTools HTTP endpoint /json/new to open a new tab (older versions accept PUT).
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:9224/json/new?$targetUrl" -Method Put -UseBasicParsing -TimeoutSec 5
  Write-Output "NEW_TAB_OK"
} catch {
  Write-Output "NEW_TAB_ERR: $($_.Exception.Message)"
}

# Also navigate the existing blank page via the page-level websocket is not available here;
# the simplest reliable path is to open a fresh tab above.
Start-Sleep -Seconds 3
$r = Invoke-WebRequest -Uri "http://127.0.0.1:9224/json/list" -UseBasicParsing -TimeoutSec 5
$j = $r.Content | ConvertFrom-Json
foreach ($t in $j) { Write-Output "ID: $($t.id) | TYPE: $($t.type) | URL: $($t.url)" }
