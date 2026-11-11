import { existsSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rm } from 'fs/promises'
import path from 'path'
import { isDeepStrictEqual } from 'util'
import { BrowserWindow } from 'electron'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import {
  simpleConfigPath,
  simpleOutputPath,
  mihomoWorkConfigPath,
  mihomoWorkDir,
  mihomoTestDir
} from '../utils/dirs'
import {
  defaultSimpleDraft,
  SIMPLE_SHARED_CONFIG_KEYS,
  type SimpleDraft,
  type SimpleState,
  type SimplePreview
} from '../../shared/simple-config'
import { applyGlobalBypass } from '../../shared/dex-bypass'
import { compileSimpleConfig, isObject, type SimpleSharedConfig } from './compiler'
import { resolveSimpleDraft } from './subscriptions'
import {
  cleanupSimpleConfig,
  cleanupSimpleDraft,
  removedSimpleResources,
  type RemovedSimpleResources
} from './references'

export const simpleWriteQueue = new WriteQueue()

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
function defaultState(): SimpleState {
  const draft = defaultSimpleDraft()
  return { version: 2, revision: 0, draft, published: clone(draft) }
}
function mergeDraft(value: unknown, base: SimpleDraft): SimpleDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base
  const candidate = value as Partial<SimpleDraft>
  return {
    ...base,
    ...candidate,
    sources: Array.isArray(candidate.sources) ? candidate.sources : base.sources,
    modules: {
      ...base.modules,
      ...(candidate.modules && typeof candidate.modules === 'object' ? candidate.modules : {})
    },
    preserved:
      candidate.preserved &&
      typeof candidate.preserved === 'object' &&
      !Array.isArray(candidate.preserved)
        ? clone(candidate.preserved)
        : base.preserved,
    moduleOrder: Array.isArray(candidate.moduleOrder) ? candidate.moduleOrder : base.moduleOrder
  }
}
export async function getSimpleState(): Promise<SimpleState> {
  if (!existsSync(simpleConfigPath())) return defaultState()
  let raw: unknown
  try {
    raw = parse(await readFile(simpleConfigPath(), 'utf8'))
  } catch {
    return defaultState()
  }
  if (!raw || typeof raw !== 'object') return defaultState()
  const base = defaultState()
  const value = raw as Partial<SimpleState>
  return {
    version: 2,
    revision: Number(value.revision) || 0,
    inheritedProfileIds: value.inheritedProfileIds || [],
    draft: mergeDraft(value.draft, base.draft),
    published: mergeDraft(value.published, base.published)
  }
}
export async function saveSimpleState(state: SimpleState): Promise<void> {
  await mkdir(mihomoWorkDir(), { recursive: true })
  const stored = structuredClone(state)
  for (const draft of [stored.draft, stored.published]) {
    for (const source of draft.sources) {
      if (!source.profileId) continue
      source.proxies = []
      delete source.content
    }
  }
  await atomicWriteFile(simpleConfigPath(), stringify(stored), { encoding: 'utf8' })
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('controledMihomoConfigUpdated')
  }
}
export async function compileAndWriteSimple(
  state: SimpleState,
  publish: boolean,
  shared?: SimpleSharedConfig
): Promise<SimplePreview> {
  const effectiveShared = shared ?? (await getSharedConfig())
  const result = compileSimpleConfig(
    await resolveSimpleDraft(publish ? state.published : state.draft),
    effectiveShared
  )
  if (result.errors.length) return result
  const { getAppConfig } = await import('../config/app')
  result.yaml = stringify(applyGlobalBypass(parse(result.yaml), (await getAppConfig()).dexBypass))
  await mkdir(mihomoWorkDir(), { recursive: true })
  await atomicWriteFile(simpleOutputPath(), result.yaml, { encoding: 'utf8' })
  await atomicWriteFile(mihomoWorkConfigPath('work'), result.yaml, { encoding: 'utf8' })
  return result
}

function validationYaml(yaml: string): string {
  const config = parse<Record<string, unknown>>(yaml)
  for (const kind of ['proxy-providers', 'rule-providers']) {
    if (!isObject(config[kind])) continue
    for (const [name, provider] of Object.entries(config[kind])) {
      if (!isObject(provider) || typeof provider.path !== 'string') continue
      if (provider.type === 'file') {
        // Local providers still resolve against the running configuration's home.
        // The manager permits reading that directory through SAFE_PATHS.
        provider.path = path.resolve(mihomoWorkDir(), provider.path)
      } else if (provider.type === 'http') {
        // A configured absolute path or ../work cache must not let -t write into
        // the live core's directory. This affects the candidate only.
        const cacheKey = createHash('sha256')
          .update(JSON.stringify([kind, name, provider.url, provider.path]))
          .digest('hex')
        provider.path = path.join(mihomoTestDir(), 'simple-providers', cacheKey)
      }
    }
  }
  return stringify(config)
}

export async function commitSimpleState(
  state: SimpleState,
  next: SimpleState,
  options: { shared?: SimpleSharedConfig; allowStandard?: boolean } = {}
): Promise<SimplePreview> {
  const previousShared = await getSharedConfig()
  const shared = structuredClone(options.shared ?? previousShared)
  const removed: RemovedSimpleResources = {
    outbounds: new Set(),
    providers: new Set(),
    ruleProviders: new Set(),
    subRules: new Set(),
    sources: new Set()
  }
  for (const key of ['draft', 'published'] as const) {
    const before = await resolveSimpleDraft(state[key])
    const after = await resolveSimpleDraft(next[key])
    const changes = removedSimpleResources(
      compileSimpleConfig(before, shared),
      compileSimpleConfig(after, shared),
      before,
      after
    )
    for (const kind of Object.keys(removed) as (keyof RemovedSimpleResources)[])
      changes[kind].forEach((name) => removed[kind].add(name))
  }
  if (Object.values(removed).some((names) => names.size)) {
    next = {
      ...next,
      draft: cleanupSimpleDraft(await resolveSimpleDraft(next.draft), removed),
      published: cleanupSimpleDraft(await resolveSimpleDraft(next.published), removed)
    }
    cleanupSimpleConfig(shared, removed)
  }
  const result = compileSimpleConfig(await resolveSimpleDraft(next.published), shared)
  if (result.errors.length) return result
  const [{ getAppConfig }, { checkProfileConfig }, { mihomoHotReloadConfig }] = await Promise.all([
    import('../config/app'),
    import('../core/manager'),
    import('../core/mihomoApi')
  ])
  const appConfig = await getAppConfig()
  result.yaml = stringify(applyGlobalBypass(parse(result.yaml), appConfig.dexBypass))
  const active = appConfig.operationMode === 'simple'
  if (!active && !options.allowStandard) throw new Error('请先切换到简易模式')
  const candidate = path.join(mihomoTestDir(), `.simple-candidate-${randomUUID()}.yaml`)
  await mkdir(mihomoTestDir(), { recursive: true })
  try {
    await atomicWriteFile(candidate, validationYaml(result.yaml), { encoding: 'utf8' })
    await checkProfileConfig(candidate, appConfig.core, undefined, {
      workDir: mihomoTestDir(),
      safePath: mihomoWorkDir(),
      timeoutMs: 30000
    })
  } catch (error) {
    return { ...result, errors: [String(error)] }
  } finally {
    await rm(candidate, { force: true })
  }
  const sharedChanged = !isDeepStrictEqual(previousShared, shared)
  const { writeSimpleSharedConfig } = await import('../config/controledMihomo')
  try {
    if (sharedChanged) await writeSimpleSharedConfig(shared)
    await saveSimpleState(next)
    if (active) await mihomoHotReloadConfig()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('simpleConfigUpdated')
      if (active) {
        window.webContents.send('groupsUpdated')
        window.webContents.send('rulesUpdated')
      }
    }
    return result
  } catch (error) {
    try {
      if (sharedChanged) await writeSimpleSharedConfig(previousShared)
      await saveSimpleState(state)
      if (active) await mihomoHotReloadConfig()
    } catch (restoreError) {
      return {
        ...result,
        errors: [`应用失败: ${String(error)}`, `恢复配置或内核失败: ${String(restoreError)}`]
      }
    }
    return { ...result, errors: [`应用失败，已恢复原配置: ${String(error)}`] }
  }
}

async function getSharedConfig(): Promise<SimpleSharedConfig> {
  const { getControledMihomoConfig } = await import('../config/controledMihomo')
  const config = await getControledMihomoConfig(true)
  return Object.fromEntries(
    SIMPLE_SHARED_CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [
      key,
      structuredClone(config[key])
    ])
  ) as SimpleSharedConfig
}
