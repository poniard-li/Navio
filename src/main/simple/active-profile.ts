import { readFile, mkdir, unlink, rename } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { BrowserWindow, dialog } from 'electron'
import {
  getProfile,
  getProfileConfig,
  saveProfileEdits,
  addProfileItem,
  removeProfileItem
} from '../config/profile'
import { dataDir } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import {
  defaultSimpleDraft,
  SIMPLE_MODULES,
  SIMPLE_BUILTIN_OUTBOUNDS,
  type SimpleDraft,
  type SimpleObject,
  type SimplePreview,
  type SimpleProxyGroupEditor,
  type SimpleRuleChange
} from '../../shared/simple-config'
import {
  readSimpleNodes,
  addSimpleNodes,
  updateSimpleNode,
  removeSimpleNode as removeNode
} from './nodes'
import {
  readSimpleGroups,
  addSimpleGroup,
  updateSimpleGroup,
  removeSimpleGroup,
  reorderSimpleGroups
} from './groups'
import {
  readSimpleRules,
  readSimpleRuleProviders,
  changeSimpleRules,
  changeSimpleRuleProvider
} from './rules'
import { compileSimpleConfig } from './compiler'
import { cleanupSimpleDraft, removedSimpleResources } from './references'

const queue = new WriteQueue()
const arrayModules = new Set(['proxies', 'proxy-groups', 'rules'])
interface TrackedDraft extends SimpleDraft {
  navioBase?: { profileId: string; fingerprint: string }
}
const staleMessage =
  '当前订阅已更新、切换或被其他编辑器修改。请保留正在编辑的文本，重新载入当前订阅后再修改，避免覆盖新配置。'
function failed(error: unknown): SimplePreview {
  return {
    yaml: '',
    errors: [error instanceof Error ? error.message : String(error)],
    references: { outbounds: [], proxyProviders: [], ruleProviders: [] }
  }
}
function toDraft(config: SimpleObject): SimpleDraft {
  const draft = defaultSimpleDraft(),
    general = { ...config }
  for (const module of Object.keys(SIMPLE_MODULES) as (keyof typeof SIMPLE_MODULES)[]) {
    if (module === 'general') continue
    draft.modules[module] = stringify(config[module] ?? (arrayModules.has(module) ? [] : {}))
    delete general[module]
  }
  draft.modules.general = stringify(general)
  draft.preserved = {}
  return draft
}
function toConfig(draft: SimpleDraft): SimpleObject {
  if (draft.sources.length) throw new Error('请在订阅页面管理来源，节点编辑使用当前订阅')
  const config = parse(draft.modules.general) as SimpleObject
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('基础配置需要 YAML 对象')
  for (const module of Object.keys(SIMPLE_MODULES) as (keyof typeof SIMPLE_MODULES)[])
    if (module !== 'general') config[module] = parse(draft.modules[module])
  return config
}
function preview(draft: SimpleDraft): SimplePreview {
  try {
    if (draft.sources.length) throw new Error('请在订阅页面管理来源，节点编辑使用当前订阅')
    return compileSimpleConfig(draft)
  } catch (error) {
    return failed(error)
  }
}
async function active(): Promise<{ id: string; draft: TrackedDraft }> {
  const { current } = await getProfileConfig()
  if (!current) throw new Error('请先导入或创建订阅配置')
  const config = (await getProfile(current)) as unknown as SimpleObject
  const draft: TrackedDraft = toDraft(config)
  draft.navioBase = {
    profileId: current,
    fingerprint: createHash('sha256').update(JSON.stringify(config)).digest('hex')
  }
  return { id: current, draft }
}
function draftPath(id: string): string {
  return join(
    dataDir(),
    'profile-local',
    `${createHash('sha256').update(id).digest('hex')}.draft.json`
  )
}
function assertBase(draft: SimpleDraft, published: TrackedDraft): void {
  const base = (draft as TrackedDraft)?.navioBase
  if (
    !base ||
    base.profileId !== published.navioBase?.profileId ||
    base.fingerprint !== published.navioBase?.fingerprint
  )
    throw new Error(staleMessage)
}
async function assertFresh(id: string, draft: SimpleDraft): Promise<void> {
  const latest = await active()
  if (latest.id !== id) throw new Error(staleMessage)
  assertBase(draft, latest.draft)
}
function prepare(before: SimpleDraft, draft: SimpleDraft): SimpleDraft {
  const removed = removedSimpleResources(preview(before), preview(draft), before, draft)
  return Object.values(removed).some((names) => names.size)
    ? cleanupSimpleDraft(draft, removed)
    : draft
}
async function loadConfig() {
  const { id, draft: published } = await active()
  let draft = published
  let draftWarning: string | undefined
  let stored: string | undefined
  try {
    stored = await readFile(draftPath(id), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (stored !== undefined) {
    try {
      const candidate = JSON.parse(stored) as TrackedDraft
      assertBase(candidate, published)
      if (preview(candidate).errors.length) throw new Error('草稿格式无法读取')
      draft = candidate
    } catch {
      // Retain the user's unfinished text for recovery, but never apply it to a newer source.
      const recoveryPath = `${draftPath(id)}.recovery-${Date.now()}-${randomUUID()}.json`
      await rename(draftPath(id), recoveryPath)
      draftWarning = `先前草稿已过期或格式不兼容，已载入最新订阅。旧草稿保留于 ${recoveryPath}，可复制需要的修改。`
    }
  }
  return { version: 2 as const, revision: 0, draft, published, draftWarning }
}
export async function getSimpleConfig() {
  return queue.run(loadConfig)
}
export async function previewSimpleConfig(): Promise<SimplePreview> {
  return preview((await getSimpleConfig()).draft)
}
export async function saveSimpleDraft(draft: SimpleDraft): Promise<SimplePreview> {
  return queue.run(async () => {
    try {
      const { id, draft: published } = await active()
      assertBase(draft, published)
      const next = prepare(published, draft),
        result = preview(next)
      if (result.errors.length) return result
      await mkdir(join(dataDir(), 'profile-local'), { recursive: true })
      await assertFresh(id, draft)
      await atomicWriteFile(draftPath(id), JSON.stringify(next))
      return result
    } catch (error) {
      return failed(error)
    }
  })
}
async function commit(id: string, draft: SimpleDraft, clearDraft = false): Promise<SimplePreview> {
  const result = preview(draft)
  if (result.errors.length) throw new Error(result.errors.join('\n'))
  await assertFresh(id, draft)
  const base = (draft as TrackedDraft).navioBase
  if (!base) throw new Error(staleMessage)
  await saveProfileEdits(id, result.yaml, { currentId: id, fingerprint: base.fingerprint })
  if (clearDraft)
    await unlink(draftPath(id)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  for (const window of BrowserWindow.getAllWindows())
    for (const name of ['simpleConfigUpdated', 'groupsUpdated', 'rulesUpdated'])
      window.webContents.send(name)
  return result
}
export async function publishSimpleConfig(draft?: SimpleDraft): Promise<SimplePreview> {
  return queue.run(async () => {
    try {
      const { id, draft: published } = await active()
      const stored = draft ? undefined : await loadConfig()
      if (stored?.draftWarning) return failed(stored.draftWarning)
      const next = draft || stored?.draft
      if (!next) throw new Error('请重新打开编辑器')
      assertBase(next, published)
      return await commit(id, prepare(published, next), true)
    } catch (error) {
      return failed(error)
    }
  })
}
export async function exportSimpleConfig(): Promise<SimplePreview & { path?: string }> {
  const result = await previewSimpleConfig()
  if (result.errors.length) return result
  const target = await dialog.showSaveDialog({
    title: '导出当前订阅配置',
    defaultPath: 'navio-profile.yaml',
    filters: [{ name: 'YAML', extensions: ['yaml'] }]
  })
  if (!target.canceled && target.filePath) {
    await atomicWriteFile(target.filePath, result.yaml)
    return { ...result, path: target.filePath }
  }
  return result
}
async function change(fn: (draft: SimpleDraft) => SimpleDraft): Promise<void> {
  await queue.run(async () => {
    const { id, draft } = await active()
    const next = fn(draft)
    // The generic rename helper walks arbitrary objects. Keep upstream extensions
    // intact; only known general fields can contain outbound references.
    const general = parse(next.modules.general) as SimpleObject
    for (const [key, value] of Object.entries(parse(draft.modules.general) as SimpleObject)) {
      if (!['listeners', 'tunnels', 'ntp'].includes(key)) general[key] = value
    }
    next.modules.general = stringify(general)
    await commit(id, prepare(draft, next))
  })
}
export async function getSimpleNode(name?: string): Promise<SimpleObject> {
  if (name === undefined) return { name: '', type: 'ss' }
  const node = readSimpleNodes((await active()).draft).find((n) => n.name === name)
  if (!node) throw new Error('节点不存在，请刷新列表')
  return node
}
export async function createSimpleNodes(values: SimpleObject[]): Promise<void> {
  await change((d) => addSimpleNodes(d, values))
}
export async function saveSimpleNode(
  name: string,
  value: SimpleObject,
  expected: SimpleObject
): Promise<void> {
  await change((d) => updateSimpleNode(d, name, value, expected))
}
export async function removeSimpleNode(name: string, expected: SimpleObject): Promise<void> {
  await change((d) => removeNode(d, name, expected))
}
export async function getSimpleProxyGroup(name?: string): Promise<SimpleProxyGroupEditor> {
  const { draft } = await active(),
    groups = readSimpleGroups(draft),
    nodes = readSimpleNodes(draft),
    result = preview(draft),
    config = toConfig(draft)
  const group =
    name === undefined
      ? { name: '', type: 'select', proxies: ['DIRECT'] }
      : groups.find((g) => g.name === name)
  if (!group) throw new Error('策略组不存在，请刷新列表')
  return {
    group,
    outbounds: result.references.outbounds.filter((v) => v !== name),
    groupNames: groups.map((g) => String(g.name)),
    proxyProviders: result.references.proxyProviders,
    sources: [],
    outboundDetails: Object.fromEntries([
      ...SIMPLE_BUILTIN_OUTBOUNDS.map((n) => [n, { type: n }]),
      ...[...nodes, ...groups].map((n) => [String(n.name), { type: String(n.type) }])
    ]),
    providerTypes: Object.fromEntries(
      Object.entries(config['proxy-providers'] as Record<string, SimpleObject>).map(([n, v]) => [
        n,
        String(v.type)
      ])
    )
  }
}
export async function createSimpleProxyGroup(value: SimpleObject): Promise<void> {
  await change((d) => addSimpleGroup(d, value))
}
export async function saveSimpleProxyGroup(
  name: string,
  value: SimpleObject,
  expected: SimpleObject
): Promise<void> {
  await change((d) => updateSimpleGroup(d, name, value, expected))
}
export async function removeSimpleProxyGroup(name: string, expected: SimpleObject): Promise<void> {
  await change((d) => removeSimpleGroup(d, name, expected))
}
export async function reorderSimpleProxyGroups(names: string[]): Promise<void> {
  await change((d) => reorderSimpleGroups(d, names))
}
export async function getSimpleRulesEditor() {
  const { draft } = await active()
  return {
    rules: readSimpleRules(draft),
    ruleProviders: readSimpleRuleProviders(draft),
    outbounds: preview(draft).references.outbounds,
    subRules: Object.keys(parse(draft.modules['sub-rules']) || {})
  }
}
export async function saveSimpleRules(value: SimpleRuleChange, expected: string[]): Promise<void> {
  await change((d) => changeSimpleRules(d, value, expected))
}
export async function saveSimpleRuleProvider(
  name: string | undefined,
  nextName: string,
  value: SimpleObject | null,
  expected?: SimpleObject
): Promise<void> {
  await change((d) => changeSimpleRuleProvider(d, name, nextName, value, expected))
}
export async function importSimpleSubscription(input: {
  url?: string
  content?: string
  name?: string
}): Promise<SimplePreview> {
  await addProfileItem({
    type: input.url ? 'remote' : 'local',
    url: input.url,
    file: input.content,
    name: input.name
  })
  return previewSimpleConfig()
}
export async function refreshSimpleSource(): Promise<SimplePreview> {
  throw new Error('请在订阅页面刷新当前订阅，来源已统一管理')
}
export async function removeSimpleSource(id: string): Promise<SimplePreview> {
  await removeProfileItem(id)
  return previewSimpleConfig()
}
