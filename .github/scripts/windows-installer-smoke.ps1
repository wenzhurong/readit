param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'

function Assert-True {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Test-RegistryValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $item = Get-Item -LiteralPath $Path
  return $item.GetValueNames() -contains $Name
}

function Get-RegistryValueSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Name
  )

  if (-not (Test-RegistryValue $Path $Name)) {
    return '<value-absent>'
  }

  $item = Get-Item -LiteralPath $Path
  $value = $item.GetValue(
    $Name,
    $null,
    [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
  )
  $serialized = ConvertTo-Json -Compress -InputObject $value
  return "$($item.GetValueKind($Name))|$serialized"
}

function Get-RegistryKeySnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return '<key-absent>'
  }

  $item = Get-Item -LiteralPath $Path
  $values = @(
    $item.GetValueNames() |
      Sort-Object |
      ForEach-Object {
        [ordered]@{
          Name = $_
          Kind = [string]$item.GetValueKind($_)
          Value = $item.GetValue(
            $_,
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
          )
        }
      }
  )
  return ConvertTo-Json -Compress -Depth 4 -InputObject $values
}

function Get-SemanticProductVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $raw = (Get-Item -LiteralPath $Path).VersionInfo.ProductVersion
  if ($raw -notmatch '^(\d+\.\d+\.\d+)') {
    throw "No semantic ProductVersion on ${Path}: ${raw}"
  }
  return $Matches[1]
}

function ConvertFrom-QuotedPath {
  param(
    [AllowNull()]
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $trimmed = $Value.Trim()
  if ($trimmed -match '^"([^"]+)"$') {
    return [IO.Path]::GetFullPath($Matches[1])
  }
  return [IO.Path]::GetFullPath($trimmed)
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
Assert-True (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) 'RUNNER_TEMP is required'
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$installDirectory = [IO.Path]::GetFullPath((Join-Path $runnerTemp 'readit-installer-smoke'))
$runnerPrefix = $runnerTemp + '\'
Assert-True ($installDirectory.StartsWith($runnerPrefix, [StringComparison]::OrdinalIgnoreCase)) `
  "Smoke install directory escaped RUNNER_TEMP: $installDirectory"

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\readit'
$progIdKey = 'HKCU:\Software\Classes\readit.md'
$mdClassKey = 'HKCU:\Software\Classes\.md'
$markdownClassKey = 'HKCU:\Software\Classes\.markdown'
$mdOpenWithKey = 'HKCU:\Software\Classes\.md\OpenWithProgids'
$markdownOpenWithKey = 'HKCU:\Software\Classes\.markdown\OpenWithProgids'
$mdUserChoiceKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice'
$markdownUserChoiceKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.markdown\UserChoice'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'readit.lnk'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'readit.lnk'
$executable = Join-Path $installDirectory 'readit-shell.exe'
$uninstaller = Join-Path $installDirectory 'uninstall.exe'
$observedInstallDirectory = $null

$associationBaseline = [ordered]@{
  MdClassDefault = Get-RegistryValueSnapshot $mdClassKey ''
  MarkdownClassDefault = Get-RegistryValueSnapshot $markdownClassKey ''
  MdUserChoice = Get-RegistryKeySnapshot $mdUserChoiceKey
  MarkdownUserChoice = Get-RegistryKeySnapshot $markdownUserChoiceKey
}

function Assert-DefaultAssociationsUnchanged {
  Assert-True (
    (Get-RegistryValueSnapshot $mdClassKey '') -ceq $associationBaseline.MdClassDefault
  ) '.md class default changed during installer smoke'
  Assert-True (
    (Get-RegistryValueSnapshot $markdownClassKey '') -ceq $associationBaseline.MarkdownClassDefault
  ) '.markdown class default changed during installer smoke'
  Assert-True (
    (Get-RegistryKeySnapshot $mdUserChoiceKey) -ceq $associationBaseline.MdUserChoice
  ) '.md UserChoice changed during installer smoke'
  Assert-True (
    (Get-RegistryKeySnapshot $markdownUserChoiceKey) -ceq $associationBaseline.MarkdownUserChoice
  ) '.markdown UserChoice changed during installer smoke'
}

function Get-RegisteredReaditPaths {
  if (-not (Test-Path -LiteralPath $uninstallKey)) {
    return $null
  }

  $entry = Get-ItemProperty -LiteralPath $uninstallKey
  if ($entry.DisplayName -ne 'readit') {
    return $null
  }

  return [pscustomobject]@{
    InstallDirectory = ConvertFrom-QuotedPath $entry.InstallLocation
    Uninstaller = ConvertFrom-QuotedPath $entry.UninstallString
  }
}

function Get-ReaditResidue {
  $paths = @(
    $installDirectory,
    $uninstallKey,
    $progIdKey,
    $startMenuShortcut,
    $desktopShortcut
  )
  if (
    -not [string]::IsNullOrWhiteSpace($observedInstallDirectory) -and
    -not $observedInstallDirectory.Equals($installDirectory, [StringComparison]::OrdinalIgnoreCase)
  ) {
    $paths += $observedInstallDirectory
  }

  $residue = @($paths | Where-Object { Test-Path -LiteralPath $_ })
  if (Test-RegistryValue $mdOpenWithKey 'readit.md') {
    $residue += "$mdOpenWithKey::readit.md"
  }
  if (Test-RegistryValue $markdownOpenWithKey 'readit.md') {
    $residue += "$markdownOpenWithKey::readit.md"
  }
  return $residue
}

function Wait-ForNoReaditResidue {
  param(
    [int]$Seconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $residue = @(Get-ReaditResidue)
    if ($residue.Count -eq 0) {
      return @()
    }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return $residue
}

function Invoke-FailedRunCleanup {
  $cleanupProblems = [Collections.Generic.List[string]]::new()
  $registered = $null
  try {
    $registered = Get-RegisteredReaditPaths
    if ($null -ne $registered) {
      $script:observedInstallDirectory = $registered.InstallDirectory
    }
  } catch {
    $cleanupProblems.Add("Could not read registered installer paths: $($_.Exception.Message)")
  }

  if (
    $null -ne $registered -and
    -not [string]::IsNullOrWhiteSpace($registered.InstallDirectory) -and
    -not [string]::IsNullOrWhiteSpace($registered.Uninstaller)
  ) {
    $registeredPrefix = $registered.InstallDirectory.TrimEnd('\') + '\'
    $trustedUninstaller =
      $registered.Uninstaller.StartsWith($registeredPrefix, [StringComparison]::OrdinalIgnoreCase) -and
      ([IO.Path]::GetFileName($registered.Uninstaller) -eq 'uninstall.exe')
    if ($trustedUninstaller -and (Test-Path -LiteralPath $registered.Uninstaller)) {
      try {
        $cleanupProcess = Start-Process -FilePath $registered.Uninstaller `
          -ArgumentList '/S' `
          -PassThru `
          -Wait
        if ($cleanupProcess.ExitCode -ne 0) {
          $cleanupProblems.Add("Cleanup uninstaller exited with $($cleanupProcess.ExitCode)")
        }
      } catch {
        $cleanupProblems.Add("Cleanup uninstaller failed: $($_.Exception.Message)")
      }
    } else {
      $cleanupProblems.Add('Registered uninstaller path was missing or outside its InstallLocation')
    }
  } elseif ($null -ne $registered) {
    $cleanupProblems.Add('Registered InstallLocation or UninstallString was missing')
  }

  $remaining = @(Wait-ForNoReaditResidue -Seconds 15)
  if ($remaining.Count -gt 0) {
    try {
      Remove-ItemProperty -LiteralPath $mdOpenWithKey -Name 'readit.md' -ErrorAction SilentlyContinue
      Remove-ItemProperty -LiteralPath $markdownOpenWithKey -Name 'readit.md' -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $progIdKey -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $startMenuShortcut -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $installDirectory) {
        Remove-Item -LiteralPath $installDirectory -Recurse -Force
      }
    } catch {
      $cleanupProblems.Add("Fallback cleanup failed: $($_.Exception.Message)")
    }
    $remaining = @(Wait-ForNoReaditResidue -Seconds 5)
  }

  if ($remaining.Count -gt 0) {
    $cleanupProblems.Add("Cleanup left residue: $($remaining -join ', ')")
  }
  try {
    Assert-DefaultAssociationsUnchanged
  } catch {
    $cleanupProblems.Add($_.Exception.Message)
  }
  if ($cleanupProblems.Count -gt 0) {
    throw "Installer smoke cleanup failed: $($cleanupProblems -join '; ')"
  }
}

$initialResidue = @(Get-ReaditResidue)
if ($initialResidue.Count -gt 0) {
  throw "Runner was not clean before the installer smoke test: $($initialResidue -join ', ')"
}

$installAttempted = $false
$lifecycleCompleted = $false
try {
  $installAttempted = $true
  $installProcess = Start-Process -FilePath $resolvedInstaller `
    -ArgumentList @('/S', "/D=$installDirectory") `
    -PassThru `
    -Wait
  Assert-True ($installProcess.ExitCode -eq 0) "Installer exited with $($installProcess.ExitCode)"

  $registered = Get-RegisteredReaditPaths
  Assert-True ($null -ne $registered) 'HKCU readit uninstall registration is missing'
  $observedInstallDirectory = $registered.InstallDirectory
  Assert-True (
    $registered.InstallDirectory.Equals($installDirectory, [StringComparison]::OrdinalIgnoreCase)
  ) "InstallLocation escaped RUNNER_TEMP: $($registered.InstallDirectory)"
  Assert-True (
    $registered.Uninstaller.Equals($uninstaller, [StringComparison]::OrdinalIgnoreCase)
  ) "UninstallString mismatch: $($registered.Uninstaller)"

  Assert-True (Test-Path -LiteralPath $executable) "Installed executable is missing: $executable"
  Assert-True (Test-Path -LiteralPath $uninstaller) "Uninstaller is missing: $uninstaller"
  Assert-True (Test-Path -LiteralPath $progIdKey) 'readit ProgID is missing'
  Assert-True (Test-RegistryValue $mdOpenWithKey 'readit.md') '.md OpenWithProgids is missing readit.md'
  Assert-True (Test-RegistryValue $markdownOpenWithKey 'readit.md') '.markdown OpenWithProgids is missing readit.md'
  Assert-True (Test-Path -LiteralPath $startMenuShortcut) 'Start menu shortcut is missing'
  Assert-True (Test-Path -LiteralPath $desktopShortcut) 'Desktop shortcut is missing'
  Assert-DefaultAssociationsUnchanged

  $uninstallEntry = Get-ItemProperty -LiteralPath $uninstallKey
  Assert-True ($uninstallEntry.DisplayVersion -eq $ExpectedVersion) `
    "DisplayVersion mismatch: expected $ExpectedVersion, got $($uninstallEntry.DisplayVersion)"
  Assert-True ((Get-SemanticProductVersion $executable) -eq $ExpectedVersion) `
    'Installed executable ProductVersion does not match the release version'
  Assert-True ((Get-SemanticProductVersion $uninstaller) -eq $ExpectedVersion) `
    'Uninstaller ProductVersion does not match the release version'

  $readitEntries = @(
    Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' |
      Where-Object {
        (Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).DisplayName -eq 'readit'
      }
  )
  Assert-True ($readitEntries.Count -eq 1) `
    "Expected one readit uninstall entry, found $($readitEntries.Count)"

  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
  Assert-True ($uninstallProcess.ExitCode -eq 0) `
    "Uninstaller exited with $($uninstallProcess.ExitCode)"

  $residue = @(Wait-ForNoReaditResidue -Seconds 15)
  Assert-True ($residue.Count -eq 0) `
    "Uninstaller left filesystem/registry residue: $($residue -join ', ')"
  Assert-DefaultAssociationsUnchanged
  $lifecycleCompleted = $true

  Write-Host "Windows installer silent smoke passed for readit $ExpectedVersion"
} finally {
  if ($installAttempted -and -not $lifecycleCompleted) {
    Invoke-FailedRunCleanup
  }
}
