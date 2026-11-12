import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

// The helper stays outside the application directory and does not elevate.
export const UPDATE_SCRIPT = String.raw`
param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$resultPath = Join-Path (Split-Path -Parent $PlanPath) 'result.json'
function Save-Result($status, $message) {
  @{status=$status;message=$message;backup=$plan.backup;version=$plan.version} | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
function Assert-Child($parent, $child) {
  $parent = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
  $child = [IO.Path]::GetFullPath($child)
  if (!$child.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update path is outside its directory.' }
}
$moved = $false
$stageSafe = $false
try {
  Assert-Child (Split-Path -Parent $PlanPath) $plan.package
  $hash = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($plan.package)
  try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
  if ($actual -ne $plan.sha256) { throw 'Package checksum mismatch.' }
  if ($plan.kind -eq 'portable') {
    $parent = Split-Path -Parent $plan.target
    if ([IO.Path]::GetPathRoot($plan.target).TrimEnd('\') -eq $plan.target.TrimEnd('\')) { throw 'Cannot update a drive root.' }
    Assert-Child $parent $plan.target
    Assert-Child $parent $plan.stage
    Assert-Child $parent $plan.backup
    if (!(Split-Path -Leaf $plan.stage).StartsWith('.navio-update-') -or !(Split-Path -Leaf $plan.backup).StartsWith('Navio-before-update')) { throw 'Invalid update directory name.' }
    if ($plan.stage -eq $plan.target -or $plan.backup -eq $plan.target -or $plan.stage -eq $plan.backup) { throw 'Update directories must be distinct.' }
    foreach ($dir in @($plan.target, $plan.stage)) {
      if ((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked application folders are not supported.' }
    }
    if (Test-Path -LiteralPath $plan.backup) { throw 'Backup directory already exists.' }
    $stageSafe = $true
  } elseif ($plan.kind -ne 'installer') { throw 'Unknown update package type.' }
  @{ready=$true;version=$plan.version} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $PlanPath) 'ready.json') -Encoding UTF8
  $process = Get-Process -Id $plan.pid -ErrorAction SilentlyContinue
  if ($process -and !$process.WaitForExit(120000)) { throw 'Navio is still running. No files were replaced.' }
  if ($plan.kind -eq 'portable') {
    $data = Join-Path $plan.target 'DEX-STUDIO-NEXT'
    if (Test-Path -LiteralPath $data) {
      if ((Get-Item -LiteralPath $data).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked data folder requires a manual update.' }
      $linked = Get-ChildItem -LiteralPath $data -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop | Select-Object -First 1
      if ($linked) { throw 'Linked data files require a manual update.' }
      Copy-Item -LiteralPath $data -Destination (Join-Path $plan.stage 'DEX-STUDIO-NEXT') -Recurse -Force
    }
    Move-Item -LiteralPath $plan.target -Destination $plan.backup
    $moved = $true
    try { Move-Item -LiteralPath $plan.stage -Destination $plan.target }
    catch { Move-Item -LiteralPath $plan.backup -Destination $plan.target; $moved = $false; throw }
  } elseif ($plan.kind -eq 'installer') {
    $install = Start-Process -FilePath $plan.package -ArgumentList @('/S', ('/D=' + $plan.target)) -Wait -PassThru -WindowStyle Hidden
    if ($install.ExitCode -ne 0) { throw ('Installer failed: ' + $install.ExitCode) }
  }
  Save-Result 'complete' 'Update installed.'
  Start-Process -FilePath (Join-Path $plan.target 'Navio.exe') -WorkingDirectory $plan.target -WindowStyle Hidden
  Remove-Item -LiteralPath $plan.package -Force -ErrorAction SilentlyContinue
} catch {
  $failure = $_.Exception.Message
  if ($moved) {
    try {
      if (Test-Path -LiteralPath $plan.target) { Move-Item -LiteralPath $plan.target -Destination $plan.stage }
      Move-Item -LiteralPath $plan.backup -Destination $plan.target
      $moved = $false
    } catch { $failure += (' Recovery could not finish. Original files: ' + $plan.backup + '. ' + $_.Exception.Message) }
  }
  if ($stageSafe -and !$moved -and (Test-Path -LiteralPath $plan.stage)) {
    try {
      Assert-Child (Split-Path -Parent $plan.target) $plan.stage
      Remove-Item -LiteralPath $plan.stage -Recurse -Force
    } catch {}
  }
  try { Save-Result 'failed' $failure } catch {}
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show(('更新未完成。请重新打开 Navio，或查看更新记录：' + $resultPath + [Environment]::NewLine + $failure), 'Navio 更新')
}
`

export interface UpdatePlan {
  pid: number
  kind: 'portable' | 'installer'
  target: string
  stage: string
  backup: string
  package: string
  sha256: string
  version: string
}
export async function startUpdateRunner(plan: UpdatePlan, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  const script = path.join(directory, 'apply-update.ps1')
  const config = path.join(directory, 'plan.json')
  await writeFile(script, '\uFEFF' + UPDATE_SCRIPT, 'utf8')
  await writeFile(config, JSON.stringify(plan), 'utf8')
  const command = `& '${script.replaceAll("'", "''")}' -PlanPath '${config.replaceAll("'", "''")}'`
  const child = spawn(
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe'
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64')
    ],
    { detached: true, stdio: 'ignore', windowsHide: true, cwd: directory }
  )
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', resolve)
  })
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  try {
    const deadline = Date.now() + 30000
    while (true) {
      try {
        const ready = JSON.parse(
          (await readFile(path.join(directory, 'ready.json'), 'utf8')).replace(/^\uFEFF/, '')
        )
        if (ready.ready === true && ready.version === plan.version) break
        throw new Error('更新程序返回了无效的准备结果。')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (exited || Date.now() >= deadline)
        throw new Error('更新程序未能完成准备，Navio 将保持运行。')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    child.kill()
    throw error
  }
  child.unref()
}
export function updateSiblingPaths(target: string): { stage: string; backup: string } {
  if (path.dirname(target) === target) throw new Error('程序位于磁盘根目录，请先移入独立文件夹。')
  const id = randomUUID()
  return {
    stage: path.join(path.dirname(target), `.navio-update-${id}`),
    backup: path.join(path.dirname(target), `Navio-before-update-${id}`)
  }
}
