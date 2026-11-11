param([string]$Executable, [switch]$LibraryOnly)

function Test-NavioStartupTarget {
    param([string]$Command, [string]$Target)
    try {
        if ([string]::IsNullOrWhiteSpace($Command) -or [string]::IsNullOrWhiteSpace($Target)) {
            return $false
        }
        $candidate = $Command.Trim()
        if ($candidate.StartsWith('"') -and $candidate.EndsWith('"')) {
            $candidate = $candidate.Substring(1, $candidate.Length - 2)
        }
        # The client writes a single absolute executable path with no arguments.
        # Unknown command formats are retained instead of guessing their owner.
        if ($candidate.Contains('"') -or -not [IO.Path]::IsPathRooted($candidate)) {
            return $false
        }
        return [string]::Equals(
            [IO.Path]::GetFullPath($candidate),
            [IO.Path]::GetFullPath($Target),
            [StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Remove-NavioStartupEntries {
    param([string]$Target)
    $failed = $false
    $runKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
    $baseKey = $null
    $key = $null
    try {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]::CurrentUser,
            [Microsoft.Win32.RegistryView]::Registry64
        )
        $key = $baseKey.OpenSubKey($runKey, $true)
        if ($null -ne $key -and (Test-NavioStartupTarget -Command $key.GetValue('dex-studio') -Target $Target)) {
            $key.DeleteValue('dex-studio', $false)
        }
    } catch {
        $failed = $true
    } finally {
        if ($null -ne $key) { $key.Dispose() }
        if ($null -ne $baseKey) { $baseKey.Dispose() }
    }
    try {
        $scheduler = New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        $folder = $scheduler.GetFolder('\')
        $task = $null
        try { $task = $folder.GetTask('dex-studio') } catch {
            if ($_.Exception.GetBaseException().HResult -ne -2147024894) { $failed = $true }
        }
        if ($null -ne $task) {
            $actions = $task.Definition.Actions
            if ($actions.Count -eq 1) {
                $action = $actions.Item(1)
                if ($action.Type -eq 0 -and [string]::IsNullOrEmpty($action.Arguments) -and
                    (Test-NavioStartupTarget -Command $action.Path -Target $Target)) {
                    $folder.DeleteTask('dex-studio', 0)
                }
            }
        }
    } catch {
        $failed = $true
    }
    return -not $failed
}

if (-not $LibraryOnly) {
    if ([string]::IsNullOrWhiteSpace($Executable) -or
        -not [IO.Path]::IsPathRooted($Executable) -or
        [IO.Path]::GetFileName($Executable) -ine 'Navio.exe') { exit 2 }
    if (-not (Remove-NavioStartupEntries -Target $Executable)) { exit 1 }
}
