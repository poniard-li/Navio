param(
    [Parameter(Mandatory=$true)][ValidateSet('Read','Apply','Restore')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$StateFile
)
$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$proxyAddress = '127.0.0.1:17890'
$names = @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL')

function Get-ProxyState {
    $key = Get-Item -LiteralPath $registryPath
    $values = @{}
    foreach ($name in $names) {
        $exists = $key.GetValueNames() -contains $name
        $values[$name] = @{ exists = $exists; value = $(if ($exists) { $key.GetValue($name) } else { $null }); kind = $(if ($exists) { $key.GetValueKind($name).ToString() } else { 'String' }) }
    }
    return $values
}

function Test-DexAppliedState {
    param($Values)
    return ($Values.ProxyEnable.exists -and $Values.ProxyEnable.value -eq 1 -and
            $Values.ProxyServer.exists -and $Values.ProxyServer.value -ceq '127.0.0.1:17890' -and
            $Values.ProxyOverride.exists -and $Values.ProxyOverride.value -ceq '<local>;localhost;127.*' -and
            -not $Values.AutoConfigURL.exists)
}

function Send-ProxyRefresh {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DexWinInet {
    [DllImport("wininet.dll", SetLastError=true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int option, IntPtr buffer, int bufferLength);
}
'@
    [void][DexWinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
    [void][DexWinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)
}

if ($Mode -eq 'Read') {
    $current = Get-ProxyState
    @{ enabled = (Test-DexAppliedState -Values $current) } | ConvertTo-Json -Compress
    exit 0
}

if ($Mode -eq 'Apply') {
    $currentBeforeApply = Get-ProxyState
    if (-not (Test-Path -LiteralPath $StateFile) -or -not (Test-DexAppliedState -Values $currentBeforeApply)) {
        $parentDirectory = [System.IO.Path]::GetDirectoryName($StateFile)
        [void][System.IO.Directory]::CreateDirectory($parentDirectory)
        $state = @{ version = 1; values = $currentBeforeApply; createdAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 6
        [System.IO.File]::WriteAllText($StateFile, $state, (New-Object System.Text.UTF8Encoding($false)))
    }
    New-ItemProperty -LiteralPath $registryPath -Name ProxyServer -Value $proxyAddress -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $registryPath -Name ProxyOverride -Value '<local>;localhost;127.*' -PropertyType String -Force | Out-Null
    Remove-ItemProperty -LiteralPath $registryPath -Name AutoConfigURL -ErrorAction SilentlyContinue
    New-ItemProperty -LiteralPath $registryPath -Name ProxyEnable -Value 1 -PropertyType DWord -Force | Out-Null
    Send-ProxyRefresh
    @{ enabled = $true } | ConvertTo-Json -Compress
    exit 0
}

if (-not (Test-Path -LiteralPath $StateFile)) {
    @{ restored = $true; reason = 'no-record' } | ConvertTo-Json -Compress
    exit 0
}
$record = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
if ($record.version -ne 1 -or $null -eq $record.values) { throw 'Invalid proxy recovery record.' }
$current = Get-ProxyState
if (-not (Test-DexAppliedState -Values $current)) {
    Remove-Item -LiteralPath $StateFile -Force
    @{ restored = $false; reason = 'changed' } | ConvertTo-Json -Compress
    exit 0
}
foreach ($name in $names) {
    $item = $record.values.$name
    if ($null -eq $item) { throw 'Incomplete proxy recovery record.' }
    if ($item.exists) {
        if ($item.kind -notin @('String','ExpandString','DWord','QWord','Binary','MultiString')) { throw 'Invalid registry value kind.' }
        New-ItemProperty -LiteralPath $registryPath -Name $name -Value $item.value -PropertyType $item.kind -Force | Out-Null
    } else {
        Remove-ItemProperty -LiteralPath $registryPath -Name $name -ErrorAction SilentlyContinue
    }
}
Send-ProxyRefresh
Remove-Item -LiteralPath $StateFile -Force
@{ restored = $true } | ConvertTo-Json -Compress
