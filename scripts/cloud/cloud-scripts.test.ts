import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runner = vi.hoisted(() => ({
  assertNodeVersion: vi.fn(),
  reportFailure: vi.fn(),
  runNode: vi.fn(),
  runPnpm: vi.fn()
}))
vi.mock('./toolchain.mjs', () => runner)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function execute(script: 'setup' | 'check', platform: string, args: string[] = []) {
  vi.stubGlobal('process', { ...process, platform, argv: ['node', script, ...args] })
  if (script === 'setup') await import('./setup.mjs')
  else await import('./check.mjs')
}

describe('cloud entry points', () => {
  it('installs only the frozen lockfile without lifecycle scripts', async () => {
    await execute('setup', 'linux')
    expect(runner.assertNodeVersion).toHaveBeenCalledOnce()
    expect(runner.runPnpm).toHaveBeenCalledExactlyOnceWith([
      'install',
      '--ignore-scripts',
      '--frozen-lockfile'
    ])
    expect(runner.runNode).not.toHaveBeenCalled()
  })

  it.each(['linux', 'win32'])(
    'runs the intended checks and compilation on %s',
    async (platform) => {
      await execute('check', platform)
      const tests = ['exec', 'vitest', 'run', '--configLoader', 'native']
      if (platform === 'win32') tests.push('--exclude', 'src/main/utils/app-info/linux.test.ts')
      expect(runner.runPnpm.mock.calls.map(([args]) => args)).toEqual([
        ['run', 'format:check'],
        ['run', 'lint:check'],
        ['run', 'typecheck'],
        tests
      ])
      expect(runner.runNode.mock.calls.map(([args]) => args)).toEqual([
        [
          '--test',
          'scripts/release-windows.test.cjs',
          'scripts/release-windows-safety.test.cjs',
          'tools/qa/common.test.cjs'
        ],
        ['scripts/build-native.mjs']
      ])
    }
  )

  it('can compile without running checks or invoking a package installer', async () => {
    await execute('check', 'linux', ['--build-only'])
    expect(runner.runPnpm).not.toHaveBeenCalled()
    expect(runner.runNode).toHaveBeenCalledExactlyOnceWith(['scripts/build-native.mjs'])
  })

  it('can run checks without compiling', async () => {
    await execute('check', 'linux', ['--checks-only'])
    expect(runner.runNode).toHaveBeenCalledExactlyOnceWith([
      '--test',
      'scripts/release-windows.test.cjs',
      'scripts/release-windows-safety.test.cjs',
      'tools/qa/common.test.cjs'
    ])
  })

  it.each([
    ['setup', ['--invalid']],
    ['check', ['--invalid']],
    ['check', ['--checks-only', '--build-only']]
  ] as const)('rejects invalid arguments before running tools: %s %s', async (script, args) => {
    await execute(script, 'linux', [...args])
    expect(runner.reportFailure).toHaveBeenCalledOnce()
    expect(runner.runPnpm).not.toHaveBeenCalled()
    expect(runner.runNode).not.toHaveBeenCalled()
  })
})
