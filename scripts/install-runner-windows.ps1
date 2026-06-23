Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "AsthriX Fusion Runner"
$DefaultCloudUrl = "https://fusion-api.asthrix.workers.dev"

$CloudUrl = $DefaultCloudUrl
$Token = ""
$RunnerId = ""
$InstallDir = ""
$ShimDir = ""
$NoStart = $false
$Foreground = $false
$AllowedRoots = New-Object System.Collections.Generic.List[string]

function Show-Usage {
  @"
Usage: scripts\install-runner-windows.ps1 [options]

Installs Fusion Runner as a Windows scheduled task. After this one-time setup,
the runner starts on user login and the task wrapper restarts it if it exits.

Options:
  --cloud-url URL      Fusion API URL. Defaults to production.
  --token TOKEN        Optional runner token.
  --runner-id ID       Stable runner ID. Defaults to user + computer.
  --allowed-root DIR   Workspace root the runner may use. Repeatable.
  --install-dir DIR    Binary install directory. Defaults to %USERPROFILE%\.fusion-harness\bin.
  --shim-dir DIR       Directory for fusion-runner.cmd. Defaults to install directory.
  --no-start           Install files without starting the scheduled task.
  --foreground         Run the runner in the foreground instead of a scheduled task.
  -h, --help           Show this help.
"@
}

function Read-NextArg {
  param(
    [string[]]$AllArgs,
    [int]$Index,
    [string]$Name
  )

  if ($Index + 1 -ge $AllArgs.Count) {
    throw "$Name requires a value."
  }

  return $AllArgs[$Index + 1]
}

for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = [string]$args[$i]
  switch ($arg) {
    { $_ -in @("--cloud-url", "-CloudUrl") } {
      $CloudUrl = Read-NextArg -AllArgs $args -Index $i -Name $arg
      $i++
      continue
    }
    { $_ -in @("--token", "-Token") } {
      $Token = Read-NextArg -AllArgs $args -Index $i -Name $arg
      $i++
      continue
    }
    { $_ -in @("--runner-id", "-RunnerId") } {
      $RunnerId = Read-NextArg -AllArgs $args -Index $i -Name $arg
      $i++
      continue
    }
    { $_ -in @("--allowed-root", "-AllowedRoot") } {
      $AllowedRoots.Add((Read-NextArg -AllArgs $args -Index $i -Name $arg))
      $i++
      continue
    }
    { $_ -in @("--install-dir", "-InstallDir") } {
      $InstallDir = Read-NextArg -AllArgs $args -Index $i -Name $arg
      $i++
      continue
    }
    { $_ -in @("--shim-dir", "-ShimDir") } {
      $ShimDir = Read-NextArg -AllArgs $args -Index $i -Name $arg
      $i++
      continue
    }
    { $_ -in @("--no-start", "-NoStart") } {
      $NoStart = $true
      continue
    }
    { $_ -in @("--foreground", "-Foreground") } {
      $Foreground = $true
      $NoStart = $true
      continue
    }
    { $_ -in @("-h", "--help", "/?") } {
      Show-Usage
      exit 0
    }
    default {
      Show-Usage | Write-Error
      throw "Unknown option: $arg"
    }
  }
}

$IsWindowsHost = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
if (-not $IsWindowsHost) {
  throw "This installer is for Windows. Use runner:install:macos on macOS."
}

if ([string]::IsNullOrWhiteSpace($CloudUrl)) {
  throw "--cloud-url cannot be empty."
}

if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
  throw "USERPROFILE is not set."
}

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
$RunnerDir = Join-Path $RepoRoot "apps\runner-go"
$ConfigDir = Join-Path $env:USERPROFILE ".fusion-harness"
$LogDir = Join-Path $ConfigDir "logs"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = if ($env:FUSION_RUNNER_INSTALL_DIR) { $env:FUSION_RUNNER_INSTALL_DIR } else { Join-Path $ConfigDir "bin" }
}
if ([string]::IsNullOrWhiteSpace($ShimDir)) {
  $ShimDir = if ($env:FUSION_RUNNER_SHIM_DIR) { $env:FUSION_RUNNER_SHIM_DIR } else { $InstallDir }
}

$BinaryPath = Join-Path $InstallDir "fusion-runner.exe"
$CmdShimPath = Join-Path $ShimDir "fusion-runner.cmd"
$ServiceScriptPath = Join-Path $ConfigDir "runner-service.ps1"
$OutLog = Join-Path $LogDir "runner.out.log"
$ErrLog = Join-Path $LogDir "runner.err.log"

if ([string]::IsNullOrWhiteSpace($RunnerId)) {
  $user = if ($env:USERNAME) { $env:USERNAME } else { "local" }
  $computer = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "windows" }
  $RunnerId = "runner_${user}_${computer}" -replace "[^A-Za-z0-9_-]+", "_"
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($Token)
      $hash = $sha.ComputeHash($bytes)
      $suffix = -join ($hash[0..5] | ForEach-Object { $_.ToString("x2") })
      $RunnerId = "${RunnerId}_${suffix}"
    } finally {
      $sha.Dispose()
    }
  }
  $RunnerId = $RunnerId.TrimEnd("_")
}

New-Item -ItemType Directory -Force -Path $InstallDir, $ShimDir, $ConfigDir, $LogDir | Out-Null

$go = Get-Command "go.exe" -ErrorAction SilentlyContinue
$bundledBinaryCandidates = @(
  (Join-Path $RepoRoot "apps\web\public\downloads\fusion-runner-windows-amd64.exe"),
  (Join-Path $RunnerDir "dist\fusion-runner-windows-amd64.exe")
)
$bundledBinary = $null
foreach ($candidate in $bundledBinaryCandidates) {
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    $bundledBinary = $candidate
    break
  }
}
if ($go) {
  Write-Host "Building Fusion Runner..."
  Push-Location $RunnerDir
  try {
    & $go.Source build -o $BinaryPath .\cmd\fusion-runner
    if ($LASTEXITCODE -ne 0) {
      throw "go build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} elseif ($bundledBinary) {
  Write-Host "Go is not installed; copying the checked-in Windows binary."
  Copy-Item -LiteralPath $bundledBinary -Destination $BinaryPath -Force
} else {
  throw "Go is required to build Fusion Runner from this checkout, and no checked-in Windows binary was found."
}

$cmdShim = "@echo off`r`n`"$BinaryPath`" %*`r`n"
Set-Content -LiteralPath $CmdShimPath -Value $cmdShim -Encoding ASCII

function Add-ToUserPath {
  param([string]$Directory)

  $full = (Resolve-Path -LiteralPath $Directory).Path.TrimEnd("\")
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if (-not [string]::IsNullOrWhiteSpace($current)) {
    $parts = $current -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  }

  $exists = $false
  foreach ($part in $parts) {
    if ($part.TrimEnd("\").Equals($full, [StringComparison]::OrdinalIgnoreCase)) {
      $exists = $true
      break
    }
  }

  if (-not $exists) {
    $updated = (@($parts) + $full) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
  }

  $envParts = $env:Path -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $envExists = $false
  foreach ($part in $envParts) {
    if ($part.TrimEnd("\").Equals($full, [StringComparison]::OrdinalIgnoreCase)) {
      $envExists = $true
      break
    }
  }
  if (-not $envExists) {
    $env:Path = "$env:Path;$full"
  }
}

Add-ToUserPath -Directory $ShimDir

$loginArgs = @("login", "--cloud-url", $CloudUrl)
if (-not [string]::IsNullOrWhiteSpace($Token)) {
  $loginArgs += @("--token", $Token)
}
& $BinaryPath @loginArgs
if ($LASTEXITCODE -ne 0) {
  throw "fusion-runner login failed with exit code $LASTEXITCODE."
}

& $BinaryPath config set runner-id $RunnerId
if ($LASTEXITCODE -ne 0) {
  throw "fusion-runner config set runner-id failed with exit code $LASTEXITCODE."
}

if ($AllowedRoots.Count -eq 0) {
  $AllowedRoots.Add($RepoRoot)
}

foreach ($root in $AllowedRoots) {
  if ([string]::IsNullOrWhiteSpace($root)) {
    continue
  }
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    Write-Warning "Skipping missing allowed root: $root"
    continue
  }

  $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
  & $BinaryPath config set allowed-root $resolvedRoot
  if ($LASTEXITCODE -ne 0) {
    throw "fusion-runner config set allowed-root failed for $resolvedRoot with exit code $LASTEXITCODE."
  }
}

function ConvertTo-PowerShellLiteral {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

$serviceScript = @"
Set-StrictMode -Version Latest
`$ErrorActionPreference = "Continue"

`$RunnerBinary = $(ConvertTo-PowerShellLiteral $BinaryPath)
`$CloudUrl = $(ConvertTo-PowerShellLiteral $CloudUrl)
`$RunnerPath = $(ConvertTo-PowerShellLiteral $env:Path)
`$OutLog = $(ConvertTo-PowerShellLiteral $OutLog)
`$ErrLog = $(ConvertTo-PowerShellLiteral $ErrLog)

New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$OutLog), (Split-Path -Parent `$ErrLog) | Out-Null
`$env:Path = `$RunnerPath

while (`$true) {
  `$startedAt = Get-Date -Format o
  Add-Content -LiteralPath `$OutLog -Value "[`$startedAt] starting Fusion Runner"
  & `$RunnerBinary serve --cloud-url `$CloudUrl >> `$OutLog 2>> `$ErrLog
  `$exitCode = `$LASTEXITCODE
  `$stoppedAt = Get-Date -Format o
  Add-Content -LiteralPath `$ErrLog -Value "[`$stoppedAt] Fusion Runner exited with code `$exitCode; restarting in 5 seconds."
  Start-Sleep -Seconds 5
}
"@
Set-Content -LiteralPath $ServiceScriptPath -Value $serviceScript -Encoding UTF8

$powershellCommand = Get-Command "powershell.exe" -ErrorAction SilentlyContinue
$powershellExe = if ($powershellCommand) { $powershellCommand.Source } else { $null }
if ([string]::IsNullOrWhiteSpace($powershellExe)) {
  $pwshCommand = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
  $powershellExe = if ($pwshCommand) { $pwshCommand.Source } else { $null }
}
if ([string]::IsNullOrWhiteSpace($powershellExe)) {
  throw "Neither powershell.exe nor pwsh.exe was found."
}

$taskArgument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ServiceScriptPath`""
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $taskArgument
$trigger = New-ScheduledTaskTrigger -AtLogOn

$settingsCommand = Get-Command New-ScheduledTaskSettingsSet
$settingsArgs = @{
  AllowStartIfOnBatteries = $true
  DontStopIfGoingOnBatteries = $true
  StartWhenAvailable = $true
  MultipleInstances = "IgnoreNew"
  ExecutionTimeLimit = (New-TimeSpan -Days 3650)
}
if ($settingsCommand.Parameters.ContainsKey("RestartCount")) {
  $settingsArgs.RestartCount = 999
}
if ($settingsCommand.Parameters.ContainsKey("RestartInterval")) {
  $settingsArgs.RestartInterval = (New-TimeSpan -Minutes 1)
}
$settings = New-ScheduledTaskSettingsSet @settingsArgs

$identity = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited

if ($Foreground) {
  Write-Host ""
  Write-Host "Fusion Runner installed (foreground mode)."
  Write-Host ""
  Write-Host "Binary:  $BinaryPath"
  Write-Host "Command: $CmdShimPath"
  Write-Host "Config:  $(Join-Path $ConfigDir "config.json")"
  Write-Host "Logs:    $OutLog"
  Write-Host "         $ErrLog"
  Write-Host ""
  Write-Host "Runner ID: $RunnerId"
  Write-Host "Cloud URL: $CloudUrl"
  Write-Host ""
  Write-Host "Starting in foreground. Press Ctrl+C to stop."
  & $BinaryPath serve --cloud-url $CloudUrl
  exit 0
}

$taskRegistered = $true
try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
} catch {
  $taskRegistered = $false
  Write-Warning "Scheduled task registration failed: $_"
  Write-Host "Falling back to foreground mode." -ForegroundColor Yellow
  Write-Host "The runner will stay active in this terminal. Press Ctrl+C to stop."
  & $BinaryPath serve --cloud-url $CloudUrl
  exit 0
}

if (-not $NoStart -and $taskRegistered) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host ""
Write-Host "Fusion Runner installed."
Write-Host ""
Write-Host "Binary:  $BinaryPath"
Write-Host "Command: $CmdShimPath"
Write-Host "Config:  $(Join-Path $ConfigDir "config.json")"
Write-Host "Task:    $TaskName"
Write-Host "Logs:    $OutLog"
Write-Host "         $ErrLog"
Write-Host ""
Write-Host "Runner ID: $RunnerId"
Write-Host "Cloud URL: $CloudUrl"
Write-Host ""
Write-Host "Open the Fusion Harness Agents page and press Refresh."
