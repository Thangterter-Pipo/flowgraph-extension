$ErrorActionPreference = 'Continue'

Write-Output '=== Chrome processes bound to chrome-profile ==='
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -match 'flow_veo\\chrome-profile' } |
  Select-Object ProcessId, ParentProcessId, CommandLine |
  Format-List

Write-Output '=== CDP port 9224 ==='
$conn = Test-NetConnection -ComputerName 127.0.0.1 -Port 9224 -InformationLevel Quiet
Write-Output "port9224_open=$conn"
if ($conn) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9224/json/list' -TimeoutSec 3
    Write-Output $resp.Content
  } catch {
    Write-Output ('CDP_ERR: ' + $_.Exception.Message)
  }
} else {
  Write-Output 'CDP_ERR: connection refused'
}

Write-Output '=== Any chrome listener on 9224 ==='
Get-NetTCPConnection -LocalPort 9224 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess |
  Format-List
