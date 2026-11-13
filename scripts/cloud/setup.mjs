import { assertNodeVersion, reportFailure, runPnpm } from './toolchain.mjs'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log(
    'Usage: node scripts/cloud/setup.mjs\nRequires Node.js 24; prepares pnpm 11.8.0 and installs locked dependencies without lifecycle scripts.'
  )
} else {
  try {
    if (args.length !== 0) throw new Error('Usage: node scripts/cloud/setup.mjs [--help]')
    assertNodeVersion()
    runPnpm(['install', '--ignore-scripts', '--frozen-lockfile'])
    console.log(
      'Source dependencies are ready. Runtime binaries, user data and server configuration are not installed.'
    )
  } catch (error) {
    reportFailure(error)
  }
}
