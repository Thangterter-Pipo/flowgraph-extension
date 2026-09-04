param(
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$taskName = "FlowVeo MCP"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = Join-Path $baseDir ".venv\Scripts\pythonw.exe"
$script = Join-Path $baseDir "start_mcp.py"

if (-not (Test-Path $pythonw)) {
    throw "pythonw.exe not found: $pythonw"
}
if (-not (Test-Path $script)) {
    throw "Supervisor not found: $script"
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"{0}"' -f $script) -WorkingDirectory $baseDir
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$task = New-ScheduledTask -Action $action -Trigger @($logonTrigger, $recoveryTrigger) `
    -Principal $principal -Settings $settings -Description (
        "FlowVeo MCP watchdog: supervises local MCP and SSH reverse tunnel; " +
        "self-heals with health checks and capped backoff."
    )

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Write-Host "Registered scheduled task '$taskName' for $userId."

if (-not $NoStart) {
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 2
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Host ("Task state: " + (Get-ScheduledTask -TaskName $taskName).State)
    Write-Host ("Last result: " + $info.LastTaskResult)
}
