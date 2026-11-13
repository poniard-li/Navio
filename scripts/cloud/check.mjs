import { assertNodeVersion, reportFailure, runNode, runPnpm } from './toolchain.mjs'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log(
    'Usage: node scripts/cloud/check.mjs [--checks-only | --build-only]\nThe default runs source checks, unit tests and compilation. It does not launch or package the application.'
  )
} else {
  try {
    if (
      args.length > 1 ||
      (args.length === 1 && !['--checks-only', '--build-only'].includes(args[0]))
    ) {
      throw new Error('Usage: node scripts/cloud/check.mjs [--checks-only | --build-only]')
    }
    assertNodeVersion()
    if (args[0] !== '--build-only') {
      runPnpm(['run', 'format:check'])
      runPnpm(['run', 'lint:check'])
      runPnpm(['run', 'typecheck'])
      const tests = ['exec', 'vitest', 'run', '--configLoader', 'native']
      if (process.platform === 'win32') {
        tests.push('--exclude', 'src/main/utils/app-info/linux.test.ts')
      }
      runPnpm(tests)
      runNode([
        '--test',
        'scripts/release-windows.test.cjs',
        'scripts/release-windows-safety.test.cjs',
        'tools/qa/common.test.cjs'
      ])
    }
    if (args[0] !== '--checks-only') {
      runNode(['scripts/build-native.mjs'])
    }
  } catch (error) {
    reportFailure(error)
  }
}
