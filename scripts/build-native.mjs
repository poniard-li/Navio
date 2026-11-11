import { mkdtempSync, rmdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveConfig } from 'electron-vite'
import { build, mergeConfig } from 'vite'

// Electron-vite 4 always bundles its TypeScript config with esbuild. Native
// loading avoids esbuild's ancestor-directory scan on restricted Windows hosts.
// Keep the project's actual config and electron-vite's own presets: do not copy
// plugins, patch dependencies, or silently replace any user build settings.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const previousDirectory = process.cwd()
const mode = process.env.BUILD_MODE || 'production'
const allScopes = ['main', 'preload', 'renderer']
const args = process.argv.slice(2)
const scopes =
  args.length === 0
    ? allScopes
    : args.length === 2 && args[0] === '--scope' && allScopes.includes(args[1])
      ? [args[1]]
      : null
const major = Number(process.versions.node.split('.')[0])
if (major < 24) throw new Error('Native config builds require Node.js 24 or newer.')
if (!scopes) throw new Error('Usage: node scripts/build-native.mjs [--scope main|preload|renderer]')

process.env.NODE_ENV_ELECTRON_VITE = 'production'
process.env.NODE_ENV = 'production'

async function resolveValue(value, scope) {
  const result = await (typeof value === 'function' ? value({ command: 'build', mode }) : value)
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`${scope} must export or return a configuration object.`)
  }
  return result
}

try {
  process.chdir(projectRoot)
  const imported = await import(pathToFileURL(join(projectRoot, 'electron.vite.config.ts')).href)
  const source = await resolveValue(imported.default, 'Electron Vite config')

  // An empty, local config directory makes the public resolveConfig API return
  // the real main/preload/renderer presets without bundling a configuration.
  // No root is supplied: their config hooks resolve the project after cwd is
  // restored, just as in the ordinary electron-vite build entry point.
  const emptyConfigDirectory = mkdtempSync(join(projectRoot, '.native-build-config-'))
  let presets
  try {
    process.chdir(emptyConfigDirectory)
    presets = (await resolveConfig({ mode }, 'build', 'production')).config
  } finally {
    process.chdir(projectRoot)
    // The directory was created by this process and remains empty. Never use a
    // recursive removal, so an unexpected file cannot be erased by cleanup.
    rmdirSync(emptyConfigDirectory)
  }
  if (!presets) throw new Error('Electron Vite did not supply its build presets.')

  for (const scope of scopes) {
    if (!source[scope]) continue
    const userConfig = await resolveValue(source[scope], scope)
    if (!presets[scope]?.plugins?.length) {
      throw new Error(`Electron Vite did not supply the ${scope} preset plugins.`)
    }
    // mergeConfig concatenates plugin arrays. This retains user plugins first,
    // then the upstream preset/plugin order used by electron-vite 4.
    const config = mergeConfig(userConfig, presets[scope])
    config.mode = process.env.BUILD_MODE || userConfig.mode || mode
    config.configFile = false
    if (config.build?.watch) config.build.watch = null
    console.log(`[native build] ${scope}: project config + Electron Vite presets`)
    await build(config)
  }
} finally {
  process.chdir(previousDirectory)
}
