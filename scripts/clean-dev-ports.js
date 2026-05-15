const { execFileSync } = require('node:child_process');

const DEV_PORTS = [3001, 5173, 5174];

if (process.platform !== 'win32') {
  console.log('[dev-clean] Port cleanup is only configured for Windows.');
  process.exit(0);
}

const powershell = `
$ErrorActionPreference = 'SilentlyContinue'
$ports = @(${DEV_PORTS.join(',')})
$currentPid = ${process.pid}
$portPids = Get-NetTCPConnection -LocalPort $ports |
  Where-Object { $_.State -in @('Listen', 'Established') } |
  Select-Object -ExpandProperty OwningProcess -Unique
$knownProjectPids = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object {
    $_.CommandLine -like '*scriptforge*node_modules*.bin*concurrently*' -or
    $_.CommandLine -like '*scriptforge*client*node_modules*.bin*vite*'
  } |
  Select-Object -ExpandProperty ProcessId
$targetPids = @($portPids + $knownProjectPids) |
  Where-Object { $_ -and $_ -ne $currentPid } |
  Sort-Object -Unique
if ($targetPids.Count -gt 0) {
  Stop-Process -Id $targetPids -Force
  Start-Sleep -Milliseconds 500
  Write-Host "[dev-clean] Stopped stale dev process ids: $($targetPids -join ', ')"
} else {
  Write-Host "[dev-clean] Ports are free."
}
`;

execFileSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershell],
  { stdio: 'inherit' }
);
