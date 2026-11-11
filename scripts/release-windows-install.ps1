param(
    [string]$Mode = $env:NAVIO_INSTALL_MODE,
    [string]$Target = $env:NAVIO_INSTALL_TARGET,
    [string]$Stage = $env:NAVIO_INSTALL_STAGE,
    [string]$ManifestPath = $env:NAVIO_INSTALL_MANIFEST,
    [string]$TemporaryDirectory = $env:NAVIO_INSTALL_TEMP,
    [string]$Installer = $env:NAVIO_INSTALL_EXE,
    [string]$OldDirectory = $env:NAVIO_INSTALL_OLD,
    [switch]$LibraryOnly
)

function Get-NavioChildPath {
    param([string]$Root, [string]$Relative)
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative -match '(^[/\\]|:|[\x00-\x1f])' -or
        ($Relative -split '[/\\]' | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' })) {
        throw "Invalid payload path: $Relative"
    }
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $Relative.Replace('/', '\')))
    if (-not $candidate.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Payload path leaves its directory: $Relative"
    }
    return $candidate
}

function Assert-NavioNoLinks {
    param([string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Installation paths cannot contain links or junctions: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Read-NavioPayloadManifest {
    param([string]$Path)
    $manifest = [IO.File]::ReadAllText($Path) | ConvertFrom-Json -ErrorAction Stop
    if ($manifest.format -ne 1 -or @($manifest.files).Count -eq 0) { throw 'Invalid payload manifest.' }
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    foreach ($file in $manifest.files) {
        if (-not ($file.path -is [string]) -or -not $seen.Add($file.path) -or
            $file.sha256 -notmatch '^[a-f0-9]{64}$' -or $file.size -lt 0 -or
            [double]$file.size -ne [long]$file.size) { throw 'Invalid payload file metadata.' }
        $null = Get-NavioChildPath -Root ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path))) -Relative $file.path
        $total += [long]$file.size
    }
    if ($total -ne [long]$manifest.payloadBytes -or -not $seen.Contains('Navio.exe') -or
        -not $seen.Contains('resources/app.asar')) { throw 'Incomplete payload manifest.' }
    return $manifest
}

function Assert-NavioPayload {
    param([string]$Root, $Manifest)
    Assert-NavioNoLinks $Root
    foreach ($file in $Manifest.files) {
        $candidate = Get-NavioChildPath $Root $file.path
        Assert-NavioNoLinks $candidate
        $item = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
        if ($item.PSIsContainer -or $item.Length -ne [long]$file.size) {
            throw "Incomplete program file: $($file.path). Installation stopped."
        }
        $stream = [IO.File]::OpenRead($candidate)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
        finally { $sha.Dispose(); $stream.Dispose() }
        if (-not [string]::Equals($hash, $file.sha256, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Program file verification failed: $($file.path). Installation stopped."
        }
    }
}

function Get-NavioVolume {
    param([string]$Path)
    if (-not ('NavioInstallerNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NavioInstallerNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetDiskFreeSpaceEx(string path, out ulong available, out ulong total, out ulong free);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetVolumePathName(string path, StringBuilder name, uint length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetVolumeNameForVolumeMountPoint(string path, StringBuilder name, uint length);
}
'@ -ErrorAction Stop
    }
    $existing = [IO.Path]::GetFullPath($Path)
    while (-not [IO.Directory]::Exists($existing)) {
        $parent = [IO.Path]::GetDirectoryName($existing)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $existing) { throw "Cannot query the destination disk: $Path" }
        $existing = $parent
    }
    $mount = New-Object Text.StringBuilder 1024
    $volume = New-Object Text.StringBuilder 1024
    [UInt64]$available = 0; [UInt64]$total = 0; [UInt64]$free = 0
    if (-not [NavioInstallerNative]::GetDiskFreeSpaceEx($existing, [ref]$available, [ref]$total, [ref]$free) -or
        -not [NavioInstallerNative]::GetVolumePathName($existing, $mount, 1024) -or
        -not [NavioInstallerNative]::GetVolumeNameForVolumeMountPoint($mount.ToString(), $volume, 1024)) {
        throw "Cannot determine available disk space: $Path"
    }
    return [pscustomobject]@{ id = $volume.ToString(); path = $mount.ToString(); free = [long]$available }
}

function Get-NavioDirectoryBytes {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return [long]0 }
    Assert-NavioNoLinks $Path
    [long]$bytes = 0
    foreach ($item in Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Existing installation contains a link: $($item.FullName)" }
        if (-not $item.PSIsContainer) { $bytes += [long]([Math]::Ceiling($item.Length / 65536.0) * 65536) }
    }
    return $bytes
}

function Get-NavioSpacePlan {
    param($Manifest, [long]$InstallerBytes, [long]$OldBytes, $TempVolume, $TargetVolume)
    [long]$payload = 0
    foreach ($file in $Manifest.files) { $payload += [long]([Math]::Ceiling($file.size / 65536.0) * 65536) }
    [long]$margin = [Math]::Max(64MB, [Math]::Ceiling($payload * 0.1))
    # Do not count space that an old-version uninstall might release.
    # The installer size safely bounds the embedded archive size.
    $requests = @(
        [pscustomobject]@{ volume = $TempVolume; required = $payload + $InstallerBytes + $OldBytes + $margin; purpose = 'temporary extraction' },
        [pscustomobject]@{ volume = $TargetVolume; required = $payload + $margin; purpose = 'program files' }
    )
    $groups = @{}
    foreach ($request in $requests) {
        $id = $request.volume.id.ToUpperInvariant()
        if ($groups.ContainsKey($id)) {
            $groups[$id].required += $request.required
            $groups[$id].purpose += ' and ' + $request.purpose
        } else {
            $groups[$id] = [pscustomobject]@{
                path = $request.volume.path; free = $request.volume.free
                required = [long]$request.required; purpose = $request.purpose
            }
        }
    }
    return @($groups.Values)
}

function Assert-NavioSpace {
    param($Plan)
    foreach ($disk in $Plan) {
        if ($disk.free -lt $disk.required) {
            $needed = [Math]::Ceiling($disk.required / 1MB)
            $free = [Math]::Floor($disk.free / 1MB)
            throw "Not enough free space on $($disk.path) for $($disk.purpose): need $needed MB, available $free MB. Free disk space or choose another installation/temporary location, then retry."
        }
    }
}

function Install-NavioPayload {
    param([string]$Source, [string]$Destination, $Manifest)
    Assert-NavioPayload $Source $Manifest
    Assert-NavioNoLinks $Destination
    if ((Test-Path -LiteralPath (Join-Path $Destination 'PORTABLE')) -or
        (Test-Path -LiteralPath (Join-Path $Destination 'DEX-STUDIO-NEXT'))) {
        throw 'The destination contains portable Navio or user data. Choose another directory.'
    }
    [long]$required = 64MB
    foreach ($file in $Manifest.files) { $required += [long]([Math]::Ceiling($file.size / 65536.0) * 65536) }
    $volume = Get-NavioVolume $Destination
    Assert-NavioSpace @([pscustomobject]@{ path = $volume.path; free = $volume.free; required = $required; purpose = 'program files' })
    foreach ($file in $Manifest.files) {
        $sourceFile = Get-NavioChildPath $Source $file.path
        $destinationFile = Get-NavioChildPath $Destination $file.path
        Assert-NavioNoLinks $destinationFile
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destinationFile))
        # File.Copy throws for a short write or disk error; there is no ignore/retry overwrite fallback.
        [IO.File]::Copy($sourceFile, $destinationFile, $true)
    }
    Assert-NavioPayload $Destination $Manifest
}

if ($LibraryOnly) { return }
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $manifest = Read-NavioPayloadManifest $ManifestPath
    switch ($Mode) {
        'Preflight' {
            Assert-NavioNoLinks $Target
            Assert-NavioNoLinks $Stage
            $tempVolume = Get-NavioVolume $TemporaryDirectory
            $targetVolume = Get-NavioVolume $Target
            $oldBytes = Get-NavioDirectoryBytes $OldDirectory
            if (-not [string]::Equals($OldDirectory, $Target, [StringComparison]::OrdinalIgnoreCase)) {
                $oldBytes += Get-NavioDirectoryBytes $Target
            }
            $plan = Get-NavioSpacePlan $manifest (Get-Item -LiteralPath $Installer -ErrorAction Stop).Length $oldBytes $tempVolume $targetVolume
            Assert-NavioSpace $plan
        }
        'VerifyStage' { Assert-NavioPayload $Stage $manifest }
        'Install' { Install-NavioPayload $Stage $Target $manifest }
        'VerifyInstalled' { Assert-NavioPayload $Target $manifest }
        default { throw 'Unknown installer verification step.' }
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 3
}
