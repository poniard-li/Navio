const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { overlaps, validatePaths, builderConfig } = require('./release-windows.cjs')

test('release paths reject existing directories, source trees and overlapping stages', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navio-release-paths-'))
  const reference = path.join(directory, 'reference')
  await fs.mkdir(path.join(reference, 'resources'), { recursive: true })
  await fs.writeFile(path.join(reference, 'resources/app.asar'), '')
  const output = path.join(directory, 'release')
  const work = path.join(directory, 'work')
  try {
    assert.deepEqual(await validatePaths(reference, output, work), { reference, output, work })
    await assert.rejects(validatePaths(reference, reference, work), /separate/)
    await assert.rejects(validatePaths(reference, path.resolve(__dirname, '..'), work), /separate/)
    await assert.rejects(validatePaths(reference, output, path.join(output, 'stage')), /separate/)
    await fs.mkdir(output)
    await assert.rejects(validatePaths(reference, output, work), /already exists/)
    assert.equal(overlaps(path.join(directory, 'work'), path.join(directory, 'work-copy')), false)
  } finally {
    // Only remove the exact temporary fixture created by this test.
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'navio-release-paths-')))
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('NSIS retains user data and uses the same Navio executable as portable builds', () => {
  const config = builderConfig('release-output', '0.6.0-beta.2')
  assert.equal(config.win.executableName, 'Navio')
  assert.equal(config.win.artifactName, 'Navio-v0.6.0-beta.2-Windows-x64-portable.zip')
  assert.equal(config.nsis.artifactName, 'Navio-v0.6.0-beta.2-Windows-x64-setup.exe')
  assert.equal(config.nsis.perMachine, false)
  assert.equal(config.nsis.deleteAppDataOnUninstall, false)
  assert.equal(config.nsis.runAfterFinish, false)
  assert.equal(config.nsis.packElevateHelper, false)
  assert.equal(config.win.signExecutable, false)
  assert.equal(config.npmRebuild, false)
  assert.notEqual(path.basename(config.directories.buildResources), 'build')
  assert.equal(path.basename(config.nsis.include), 'navio-installer.nsh')
})

test(
  'startup cleanup only recognizes the exact installed executable',
  { skip: process.platform !== 'win32' },
  () => {
    const helper = path.join(__dirname, 'release-windows-uninstall.ps1').replace(/'/g, "''")
    const script = `
    . '${helper}' -LibraryOnly
    $target = 'C:\\Programs\\Navio\\Navio.exe'
    @(
      (Test-NavioStartupTarget '"C:\\Programs\\Navio\\Navio.exe"' $target),
      (Test-NavioStartupTarget 'c:\\programs\\navio\\NAVIO.EXE' $target),
      (Test-NavioStartupTarget '"D:\\Portable\\Navio\\Navio.exe"' $target),
      (Test-NavioStartupTarget '"C:\\Programs\\Navio\\Navio.exe" --other-app' $target),
      (Test-NavioStartupTarget 'C:\\Programs\\Navio-copy\\Navio.exe' $target),
      (Test-NavioStartupTarget 'Navio.exe' $target),
      (Test-NavioStartupTarget '' $target)
    ) | ConvertTo-Json -Compress
  `
    const result = spawnSync(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout.trim()), [
      true,
      true,
      false,
      false,
      false,
      false,
      false
    ])
  }
)

test('installer hooks protect portable data and require a normal application exit', async () => {
  const hook = await fs.readFile(path.join(__dirname, '../resources/navio-installer.nsh'), 'utf8')
  assert.match(hook, /!macro customCheckAppRunning[\s\S]*?!insertmacro NavioValidateTarget/)
  assert.match(hook, /FileExists\} "\$INSTDIR\\PORTABLE"/)
  assert.match(hook, /FileExists\} "\$INSTDIR\\DEX-STUDIO-NEXT"/)
  assert.match(hook, /!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"/)
  assert.match(hook, /!macro customInit\s+!insertmacro NavioRequireCurrentUser/)
  assert.doesNotMatch(hook, /taskkill|Stop-Process|::KillProcess|::CloseProcess|KILL_PROCESS/i)
  assert.match(hook, /\$\{IfNot\} \$\{isUpdated\}/)
})
