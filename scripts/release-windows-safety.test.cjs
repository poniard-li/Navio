const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const {
  createPayloadManifest,
  createInstallerSafetyFiles,
  verifyInstallerTemplates,
  templateHashes
} = require('./release-windows-safety.cjs')

const testRoot = process.env.NAVIO_INSTALLER_TEST_ROOT || os.tmpdir()
const helper = path.join(__dirname, 'release-windows-install.ps1')
const windows = process.platform === 'win32'

async function fixture(run) {
  const root = await fs.realpath(testRoot)
  const directory = await fs.mkdtemp(path.join(root, 'navio-installer-safety-'))
  const payload = path.join(directory, 'payload')
  await fs.mkdir(path.join(payload, 'resources'), { recursive: true })
  await fs.writeFile(path.join(payload, 'Navio.exe'), 'MZ' + 'n'.repeat(2000))
  await fs.writeFile(path.join(payload, 'resources/app.asar'), 'archive contents')
  const manifest = await createPayloadManifest(payload)
  const manifestPath = path.join(directory, 'payload.json')
  await fs.writeFile(manifestPath, JSON.stringify(manifest))
  try {
    await run({ directory, payload, manifest, manifestPath })
  } finally {
    assert.equal(path.dirname(directory), root)
    assert.ok(path.basename(directory).startsWith('navio-installer-safety-'))
    await fs.rm(directory, { recursive: true, force: true })
  }
}

function powershell(script, environment) {
  return spawnSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        TEMP: testRoot,
        TMP: testRoot,
        NAVIO_TEST_HELPER: helper,
        ...environment
      }
    }
  )
}

function runMode(mode, item, extra = {}) {
  return powershell('& ([scriptblock]::Create([IO.File]::ReadAllText($env:NAVIO_TEST_HELPER)))', {
    NAVIO_INSTALL_MODE: mode,
    NAVIO_INSTALL_MANIFEST: item.manifestPath,
    NAVIO_INSTALL_STAGE: item.payload,
    NAVIO_INSTALL_TARGET: path.join(item.directory, 'target'),
    NAVIO_INSTALL_TEMP: item.directory,
    NAVIO_INSTALL_EXE: path.join(item.payload, 'Navio.exe'),
    NAVIO_INSTALL_OLD: '',
    ...extra
  })
}

test('generated safety files describe the actual payload and escape NSIS dollar paths', async () => {
  await fixture(async ({ directory, payload, manifest }) => {
    assert.equal(manifest.payloadBytes, 2018)
    const safety = await createInstallerSafetyFiles(payload, path.join(directory, '$safe'))
    const include = await fs.readFile(safety.includePath, 'utf8')
    assert.ok(include.includes('$$safe'))
    assert.deepEqual(safety.manifest, manifest)
    const override = await fs.readFile(path.join(directory, '$safe/extract-override.nsh'), 'utf8')
    assert.match(override, /!macroundef installApplicationFiles/)
    assert.doesNotMatch(override, /Nsis7z|CopyFiles|copyFile/)
  })
})

test('a changed upstream installer template blocks packaging', async () => {
  await fixture(async ({ directory }) => {
    const templateRoot = path.join(__dirname, '../node_modules/app-builder-lib/templates/nsis')
    const copied = path.join(directory, 'templates')
    for (const file of Object.keys(templateHashes)) {
      await fs.mkdir(path.dirname(path.join(copied, file)), { recursive: true })
      await fs.copyFile(path.join(templateRoot, file), path.join(copied, file))
    }
    await verifyInstallerTemplates(copied)
    await fs.appendFile(path.join(copied, 'installSection.nsh'), '\n# changed upstream\n')
    await assert.rejects(verifyInstallerTemplates(copied), /Review.*installSection/)
  })
})

test(
  'space preflight rejects a full TEMP disk and combines requirements on the same volume',
  { skip: !windows },
  async () => {
    await fixture(async ({ manifestPath }) => {
      const result = powershell(
        `
$ErrorActionPreference = 'Stop'
. $env:NAVIO_TEST_HELPER -LibraryOnly
$manifest = Read-NavioPayloadManifest $env:NAVIO_TEST_MANIFEST
$testTempVolume = [pscustomobject]@{ id='temp'; path='C:\\'; free=0L }
$testTargetVolume = [pscustomobject]@{ id='target'; path='D:\\'; free=1GB }
$separate = @(Get-NavioSpacePlan $manifest 10MB 20MB $testTempVolume $testTargetVolume)
$fullTemp = $false
try { Assert-NavioSpace $separate } catch { $fullTemp = $_.Exception.Message.Contains('C:\\') }
$testTempVolume.free = 1GB
$testTargetVolume.id = 'temp'
$same = @(Get-NavioSpacePlan $manifest 10MB 20MB $testTempVolume $testTargetVolume)
$combined = $same.Count -eq 1 -and $same[0].required -eq ($separate | Measure-Object required -Sum).Sum
$same[0].free = $same[0].required - 1
$lowCombined = $false
try { Assert-NavioSpace $same } catch { $lowCombined = $true }
@($fullTemp, $combined, $lowCombined) | ConvertTo-Json -Compress
`,
        { NAVIO_TEST_MANIFEST: manifestPath }
      )
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout.trim()), [true, true, true])
    })
  }
)

test(
  'a complete payload passes preflight, copies and verifies every installed file',
  { skip: !windows },
  async () => {
    await fixture(async (item) => {
      for (const mode of ['Preflight', 'VerifyStage', 'Install', 'VerifyInstalled']) {
        const result = runMode(mode, item)
        assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
      }
      assert.equal(
        await fs.readFile(path.join(item.directory, 'target/Navio.exe'), 'utf8'),
        await fs.readFile(path.join(item.payload, 'Navio.exe'), 'utf8')
      )
    })
  }
)

test(
  'truncated, corrupted and missing staged files fail before any existing installation changes',
  { skip: !windows },
  async () => {
    await fixture(async (item) => {
      const target = path.join(item.directory, 'target')
      await fs.mkdir(target)
      await fs.writeFile(path.join(target, 'keep.txt'), 'existing files')
      const executable = path.join(item.payload, 'Navio.exe')
      const original = await fs.readFile(executable)
      for (const content of [
        original.subarray(0, 1000),
        Buffer.alloc(original.length, 'x'),
        null
      ]) {
        if (content) await fs.writeFile(executable, content)
        else await fs.unlink(executable)
        const result = runMode('VerifyStage', item)
        assert.equal(result.status, 3, result.stderr)
        assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'existing files')
        assert.deepEqual(await fs.readdir(target), ['keep.txt'])
      }
    })
  }
)

test(
  'target copy errors return failure and installed corruption cannot pass verification',
  { skip: !windows },
  async () => {
    await fixture(async (item) => {
      const target = path.join(item.directory, 'target')
      await fs.mkdir(target)
      await fs.writeFile(path.join(target, 'resources'), 'blocks destination directory')
      const copy = runMode('Install', item)
      assert.equal(copy.status, 3, copy.stderr)
      assert.equal(
        await fs.readFile(path.join(target, 'resources'), 'utf8'),
        'blocks destination directory'
      )
      await fs.unlink(path.join(target, 'resources'))
      assert.equal(runMode('Install', item).status, 0)
      await fs.writeFile(path.join(target, 'Navio.exe'), 'MZ truncated')
      assert.equal(runMode('VerifyInstalled', item).status, 3)
    })
  }
)
