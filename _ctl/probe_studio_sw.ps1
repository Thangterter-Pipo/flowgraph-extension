$ErrorActionPreference = 'Stop'

$list = Invoke-RestMethod -Uri 'http://127.0.0.1:9224/json/list' -TimeoutSec 5
$studio = $list | Where-Object { $_.type -eq 'page' -and $_.url -like '*studio.html*' } | Select-Object -First 1
if (-not $studio) {
  Write-Output 'NO_STUDIO_TARGET'
  exit 1
}

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$studio.webSocketDebuggerUrl, $cts).GetAwaiter().GetResult()

$id = 1
function Send-CDP {
  param([string]$method, [hashtable]$params = @{})
  $global:script:wsid++
  $msgId = $global:script:wsid
  $json = @{ id = $msgId; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = [System.ArraySegment[byte]]::new($bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts).GetAwaiter().GetResult()
  return $msgId
}

$global:script:wsid = 0

$expr = @'
(async () => {
  const out = {};
  try {
    const status = await chrome.runtime.sendMessage({ type: 'PING_HEALTH' });
    out.ping = status;
  } catch (e) {
    out.pingErr = String(e && e.message || e);
  }
  try {
    const ext = chrome.runtime.getManifest();
    out.manifestName = ext.name;
    out.manifestVersion = ext.version;
  } catch (e) {
    out.manifestErr = String(e && e.message || e);
  }
  try {
    out.lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
  } catch (e) {
    out.lastError = String(e && e.message || e);
  }
  return out;
})()
'@

$msgId = Send-CDP 'Runtime.evaluate' @{ expression = $expr; awaitPromise = $true; returnByValue = $true }

$buffer = [byte[]]::new(65536)
$resultRaw = $null
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  $rseg = [System.ArraySegment[byte]]::new($buffer)
  $recv = $ws.ReceiveAsync($rseg, $cts).GetAwaiter().GetResult()
  $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $recv.Count)
  $obj = $text | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($obj.id -eq $msgId) {
    $resultRaw = $obj
    break
  }
}

if ($resultRaw) {
  if ($resultRaw.result -and $resultRaw.result.result) {
    Write-Output ($resultRaw.result.result.value | ConvertTo-Json -Depth 10)
  } else {
    Write-Output ($resultRaw | ConvertTo-Json -Depth 10)
  }
} else {
  Write-Output 'NO_RESPONSE_FROM_STUDIO'
}

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $cts).GetAwaiter().GetResult()
