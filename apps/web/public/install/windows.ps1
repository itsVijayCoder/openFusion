Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$TaskName = "AsthriX Fusion Runner"
$DefaultCloudUrl = "https://fusion-api.asthrix.workers.dev"
$DefaultBinaryUrl = "https://fusion-harness.asthrix.workers.dev/downloads/fusion-runner-windows-amd64.exe"

$CloudUrl = $DefaultCloudUrl
$BinaryUrl = $DefaultBinaryUrl
$Token = ""
$RunnerId = ""
$InstallDir = ""
$ShimDir = ""
$NoStart = $false
$AllowedRoots = New-Object System.Collections.Generic.List[string]

function Show-Usage {
  @"
Usage: windows.ps1 [options]

Installs Fusion Runner as a Windows scheduled task. This hosted installer does
not require a Fusion Harness source checkout or package.json.

Options:
  --cloud-url URL      Fusion API URL. Defaults to production.
  --binary-url URL     Runner .exe download URL. Defaults to production.
  --token TOKEN        Optional runner token.
  --runner-id ID       Stable runner ID. Defaults to user + computer.
  --allowed-root DIR   Workspace root the runner may use. Repeatable.
  --install-dir DIR    Binary install directory. Defaults to %USERPROFILE%\.fusion-harness\bin.
  --shim-dir DIR       Directory for fusion-runner.cmd. Defaults to install directory.
  --no-start           Install files without starting the scheduled task.
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
    { $_ -in @("--binary-url", "-BinaryUrl") } {
      $BinaryUrl = Read-NextArg -AllArgs $args -Index $i -Name $arg
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
  throw "This installer is for Windows."
}

if ([string]::IsNullOrWhiteSpace($CloudUrl)) {
  throw "--cloud-url cannot be empty."
}
if ([string]::IsNullOrWhiteSpace($BinaryUrl)) {
  throw "--binary-url cannot be empty."
}
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
  throw "USERPROFILE is not set."
}

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
  $RunnerId = $RunnerId.TrimEnd("_")
}

New-Item -ItemType Directory -Force -Path $InstallDir, $ShimDir, $ConfigDir, $LogDir | Out-Null

Write-Host "Downloading Fusion Runner..."
Invoke-WebRequest -Uri $BinaryUrl -OutFile $BinaryPath -UseBasicParsing
$binary = Get-Item -LiteralPath $BinaryPath
if ($binary.Length -lt 1048576) {
  throw "Downloaded runner binary is unexpectedly small: $($binary.Length) bytes."
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
  $defaultRoots = @(
    (Join-Path -Path $env:USERPROFILE -ChildPath "Projects")
    (Join-Path -Path $env:USERPROFILE -ChildPath "Documents")
  )
  foreach ($defaultRoot in $defaultRoots) {
    if (Test-Path -LiteralPath $defaultRoot -PathType Container) {
      $AllowedRoots.Add($defaultRoot)
    }
  }
  if ($AllowedRoots.Count -eq 0) {
    $AllowedRoots.Add($env:USERPROFILE)
  }
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
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

if (-not $NoStart) {
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
