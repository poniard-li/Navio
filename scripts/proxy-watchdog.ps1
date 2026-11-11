param(
    [Parameter(Mandatory=$true)][int]$ParentId,
    [Parameter(Mandatory=$true)][int]$CoreId,
    [Parameter(Mandatory=$true)][string]$CorePath,
    [Parameter(Mandatory=$true)][string]$StateFile
)
$ErrorActionPreference = 'Stop'
try {
    $parentProcess = Get-Process -Id $ParentId -ErrorAction Stop
    $parentStart = $parentProcess.StartTime.ToUniversalTime().Ticks
    $coreProcess = Get-Process -Id $CoreId -ErrorAction Stop
    $coreStart = $coreProcess.StartTime.ToUniversalTime().Ticks
    if (-not [string]::Equals($coreProcess.Path, $CorePath, [StringComparison]::OrdinalIgnoreCase)) { exit 0 }
    while ($true) {
        Start-Sleep -Milliseconds 1500
        $coreCurrent = Get-Process -Id $CoreId -ErrorAction SilentlyContinue
        if ($null -eq $coreCurrent -or $coreCurrent.StartTime.ToUniversalTime().Ticks -ne $coreStart) { exit 0 }
        $parentCurrent = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
        if ($null -eq $parentCurrent -or $parentCurrent.StartTime.ToUniversalTime().Ticks -ne $parentStart) { break }
    }
    if ([string]::Equals($coreCurrent.Path, $CorePath, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $CoreId -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $StateFile) { & (Join-Path $PSScriptRoot 'proxy-state.ps1') -Mode Restore -StateFile $StateFile | Out-Null }
} catch { exit 1 }
