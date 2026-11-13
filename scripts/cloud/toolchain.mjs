import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const pnpmVersion = '11.8.0'
const environment = {
  ...process.env,
  CI: 'true',
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  ELECTRON_SKIP_BINARY_DOWNLOAD: '1'
}

export function assertNodeVersion() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error(
      `Node.js 24 is required; found ${process.version}. Install Node.js 24 and rerun this command.`
    )
  }
}

function invoke(command, args, capture = false) {
  // npm and pnpm are batch launchers on Windows. Only fixed tool names and
  // arguments from these scripts are accepted by this shell boundary.
  if (
    process.platform === 'win32' &&
    [command, ...args].some((value) => !/^[a-zA-Z0-9_@./\\:=+-]+$/.test(value))
  ) {
    throw new Error('Unsupported command argument.')
  }
  const result =
    process.platform === 'win32'
      ? spawnSync(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', [command, ...args].join(' ')],
          {
            cwd: projectRoot,
            env: environment,
            encoding: 'utf8',
            stdio: capture ? 'pipe' : 'inherit',
            windowsHide: true
          }
        )
      : spawnSync(command, args, {
          cwd: projectRoot,
          env: environment,
          encoding: 'utf8',
          stdio: capture ? 'pipe' : 'inherit'
        })
  return result
}

function requireSuccess(result, label) {
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(
      `${label} failed${result.signal ? ` (${result.signal})` : ` (exit ${result.status})`}.`
    )
  }
}

let pnpmCommand
export function preparePnpm() {
  assertNodeVersion()
  if (pnpmCommand) return
  const installed = invoke('pnpm', ['--version'], true)
  if (installed.status === 0 && installed.stdout.trim() === pnpmVersion) {
    pnpmCommand = { command: 'pnpm', prefix: [] }
    return
  }
  console.log(`Using pnpm ${pnpmVersion} through npm exec; no global installation is changed.`)
  const prefix = ['exec', '--yes', `--package=pnpm@${pnpmVersion}`, '--', 'pnpm']
  const pinned = invoke('npm', [...prefix, '--version'], true)
  requireSuccess(pinned, 'Pinned pnpm preparation')
  if (pinned.stdout.trim() !== pnpmVersion) {
    throw new Error(`Expected pnpm ${pnpmVersion}; received ${pinned.stdout.trim()}.`)
  }
  pnpmCommand = { command: 'npm', prefix }
}

export function runPnpm(args) {
  preparePnpm()
  console.log(`> pnpm ${args.join(' ')}`)
  requireSuccess(invoke(pnpmCommand.command, [...pnpmCommand.prefix, ...args]), 'pnpm')
}

export function runNode(args) {
  console.log(`> node ${args.join(' ')}`)
  requireSuccess(
    spawnSync(process.execPath, args, {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
      windowsHide: true
    }),
    'Node.js command'
  )
}

export function reportFailure(error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
