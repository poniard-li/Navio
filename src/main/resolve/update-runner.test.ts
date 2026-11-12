import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { it, expect } from 'vitest'
import { UPDATE_SCRIPT } from './update-runner'
const exec = promisify(execFile)
it
  .skipIf(process.platform !== 'win32')
  .each(['success', 'checksum', 'move-failure', 'restart-failure'])(
  'portable updater preserves data across %s in an isolated Windows directory',
  async (scenario) => {
    const root = await mkdtemp(path.join(tmpdir(), 'navio-helper-test-'))
    try {
      const target = path.join(root, 'Navio'),
        stage = path.join(root, '.navio-update-stage'),
        backup = path.join(root, 'Navio-before-update'),
        cache = path.join(root, 'cache')
      await mkdir(path.join(target, 'DEX-STUDIO-NEXT'), { recursive: true })
      await mkdir(stage)
      await mkdir(cache)
      await writeFile(path.join(target, 'Navio.exe'), 'old')
      await writeFile(path.join(stage, 'Navio.exe'), 'new')
      await writeFile(path.join(target, 'DEX-STUDIO-NEXT/config.yaml'), 'private settings')
      const packagePath = path.join(cache, 'package.zip')
      await writeFile(packagePath, 'archive')
      const plan = {
        pid: 2147483647,
        kind: 'portable',
        target,
        stage,
        backup,
        package: packagePath,
        sha256:
          scenario === 'checksum'
            ? '0'.repeat(64)
            : createHash('sha256').update('archive').digest('hex'),
        version: '0.6.0-beta.6'
      }
      await writeFile(path.join(cache, 'plan.json'), JSON.stringify(plan))
      let script = UPDATE_SCRIPT.replace(
        "Start-Process -FilePath (Join-Path $plan.target 'Navio.exe') -WorkingDirectory $plan.target -WindowStyle Hidden",
        "Write-Output 'restart-ready'"
      ).replace(/ {2}Add-Type -AssemblyName System.Windows.Forms[\s\S]+?\n}/, '\n}')
      if (scenario === 'move-failure')
        script = script.replace(
          'try { Move-Item -LiteralPath $plan.stage -Destination $plan.target }',
          "try { throw 'Injected replacement failure' }"
        )
      if (scenario === 'restart-failure')
        script = script.replace("Write-Output 'restart-ready'", "throw 'Injected restart failure'")
      await writeFile(path.join(cache, 'apply.ps1'), '\uFEFF' + script)
      const result = await exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(cache, 'apply.ps1'),
          '-PlanPath',
          path.join(cache, 'plan.json')
        ],
        { windowsHide: true, timeout: 15000 }
      )
      const outcome = JSON.parse(
        (await readFile(path.join(cache, 'result.json'), 'utf8')).replace(/^\uFEFF/, '')
      )
      if (scenario !== 'success') {
        expect(outcome.status).toBe('failed')
        expect(await readFile(path.join(target, 'Navio.exe'), 'utf8')).toBe('old')
        expect(await readFile(path.join(target, 'DEX-STUDIO-NEXT/config.yaml'), 'utf8')).toBe(
          'private settings'
        )
        expect(result.stdout).not.toContain('restart-ready')
        return
      }
      expect(outcome.status, outcome.message).toBe('complete')
      expect(result.stdout).toContain('restart-ready')
      expect(await readFile(path.join(target, 'Navio.exe'), 'utf8')).toBe('new')
      expect(await readFile(path.join(target, 'DEX-STUDIO-NEXT/config.yaml'), 'utf8')).toBe(
        'private settings'
      )
      expect(await readFile(path.join(backup, 'Navio.exe'), 'utf8')).toBe('old')
      expect(
        JSON.parse((await readFile(path.join(cache, 'result.json'), 'utf8')).replace(/^\uFEFF/, ''))
          .status
      ).toBe('complete')
    } finally {
      expect(path.dirname(root)).toBe(path.resolve(tmpdir()))
      expect(path.basename(root)).toMatch(/^navio-helper-test-/)
      await rm(root, { recursive: true, force: true })
    }
  }
)
