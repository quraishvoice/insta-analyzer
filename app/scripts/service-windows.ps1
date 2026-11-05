# تشغيل الأداة في الخلفية على ويندوز: مهمة مجدولة تبدأ مع تسجيل الدخول، والنافذة مخفية
# الاستخدام: powershell -ExecutionPolicy Bypass -File scripts\service-windows.ps1 install | restart | stop | uninstall | status
param([string]$Action = "install")
$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $PSScriptRoot
$Task = "InstaAnalyzer"
$Log = Join-Path $env:LOCALAPPDATA "insta-analyzer.log"
$Port = 3030
$envFile = Join-Path $Dir ".env"
if (Test-Path $envFile) { $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1; if ($m) { $Port = [int]$m.Matches[0].Groups[1].Value } }

function Stop-App {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

switch ($Action) {
  "install" {
    $Node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $Node) { throw "Node.js مو مثبت" }
    New-Item -ItemType Directory -Force -Path (Join-Path $Dir "data") | Out-Null
    # سكربت VBS يشغّل node بدون نافذة، ويكتب السجل
    $cmd = "cmd /c cd /d `"$Dir`" && `"$Node`" --env-file-if-exists=.env --disable-warning=ExperimentalWarning server.js >> `"$Log`" 2>&1"
    $vbs = Join-Path $Dir "data\run-hidden.vbs"
    Set-Content -Path $vbs -Encoding Unicode -Value ("CreateObject(""WScript.Shell"").Run """ + ($cmd -replace '"', '""') + """, 0, False")
    $a = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
    $t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $Task -Action $a -Trigger $t -Settings $s -Force | Out-Null
    Stop-App
    Start-ScheduledTask -TaskName $Task
    Write-Output "تم التشغيل. السجل: $Log"
  }
  "restart" { Stop-App; Start-Sleep 1; Start-ScheduledTask -TaskName $Task }
  "stop" { Stop-App }
  "uninstall" { Stop-App; Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue; Write-Output "انشال التشغيل التلقائي. بياناتك باقية في $Dir\data" }
  "status" { if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { "شغالة على $Port" } else { "مو شغالة" } }
  default { throw "الاستخدام: install | restart | stop | uninstall | status" }
}
