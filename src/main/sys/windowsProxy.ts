import { execFileSync } from 'child_process'

interface RegistryValue {
  exists: boolean
  kind: string
  value: string | number | number[] | string[] | null
}

export interface WindowsProxyState {
  internet: Record<string, RegistryValue>
  connections: Record<string, RegistryValue>
}

const registryPrelude = String.raw`
$ErrorActionPreference = 'Stop'
$base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$groups = @{
  internet = @{ path = $base; names = @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL','AutoDetect') }
  connections = @{ path = "$base\Connections"; names = @('DefaultConnectionSettings','SavedLegacySettings') }
}
`

function runPowerShell(script: string): string {
  return execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }
  ).trim()
}

// Keep the exact per-protocol ProxyServer string, registry types, absent values,
// and WinINet autodetection flags. The native host/port getter cannot represent them.
export function readWindowsProxyState(): WindowsProxyState {
  const output = runPowerShell(
    registryPrelude +
      String.raw`
$result = @{}
foreach ($groupName in @('internet','connections')) {
  $group = $groups[$groupName]
  $key = Get-Item -LiteralPath $group.path -ErrorAction SilentlyContinue
  $values = @{}
  foreach ($name in $group.names) {
    $exists = $null -ne $key -and $key.GetValueNames() -contains $name
    $values[$name] = @{
      exists = $exists
      kind = $(if ($exists) { $key.GetValueKind($name).ToString() } else { 'String' })
      value = $(if ($exists) { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null })
    }
  }
  $result[$groupName] = $values
}
$result | ConvertTo-Json -Depth 8 -Compress
`
  )
  return JSON.parse(output) as WindowsProxyState
}

export function restoreWindowsProxyState(state: WindowsProxyState): void {
  // Encode data separately: proxy values never become PowerShell source.
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
  runPowerShell(
    registryPrelude +
      `
$state = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
` +
      String.raw`
foreach ($groupName in @('internet','connections')) {
  $group = $groups[$groupName]
  foreach ($name in $group.names) {
    $item = $state.$groupName.$name
    if ($null -eq $item -or $null -eq $item.exists) { throw 'Incomplete proxy recovery record.' }
    if ($item.exists -and $item.kind -notin @('String','ExpandString','DWord','QWord','Binary','MultiString')) {
      throw 'Invalid proxy registry value type.'
    }
  }
}
foreach ($groupName in @('internet','connections')) {
  $group = $groups[$groupName]
  foreach ($name in $group.names) {
    $item = $state.$groupName.$name
    if ($item.exists) {
      if (-not (Test-Path -LiteralPath $group.path)) { New-Item -Path $group.path -Force | Out-Null }
      $value = $item.value
      if ($item.kind -eq 'Binary') { $value = [byte[]]$value }
      if ($item.kind -eq 'MultiString') { $value = [string[]]$value }
      New-ItemProperty -LiteralPath $group.path -Name $name -Value $value -PropertyType $item.kind -Force | Out-Null
    } else {
      $key = Get-Item -LiteralPath $group.path -ErrorAction SilentlyContinue
      if ($null -ne $key -and $key.GetValueNames() -contains $name) {
        Remove-ItemProperty -LiteralPath $group.path -Name $name -ErrorAction Stop
      }
    }
  }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DexWinInet {
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr handle, int option, IntPtr buffer, int size);
}
'@
if (-not [DexWinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)) { throw 'Failed to notify WinINet settings change.' }
if (-not [DexWinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)) { throw 'Failed to refresh WinINet settings.' }
`
  )
}
