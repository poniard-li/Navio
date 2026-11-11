import { dialog } from 'electron'
import { randomBytes } from 'crypto'
import { readdir, readFile, realpath, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import { parseDocument } from 'yaml'
import type {
  CfwMigrationCandidate,
  CfwMigrationPreview,
  CfwMigrationResult,
  CfwMigrationSelection
} from '../../shared/cfw-migration'
import { setProfileStr, updateProfileConfig } from '../config/profile'
import { addOverrideItem } from '../config/override'
import { stringify } from '../utils/yaml'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 48 * 1024 * 1024
const MAX_PROFILES = 150
const PLAN_LIFETIME_MS = 15 * 60 * 1000
const plans = new Map<string, MigrationPlan>()

interface MigrationPlan {
  preview: CfwMigrationPreview
  profiles: { candidate: CfwMigrationCandidate; content: string; url?: string; interval?: number }[]
  overrides: { id: string; name: string; content: string }[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseObject(content: string): Record<string, unknown> {
  const document = parseDocument(content, { merge: true, uniqueKeys: true })
  if (document.errors.length) throw new Error('YAML 格式无效或包含重复字段')
  const value: unknown = document.toJS({ maxAliasCount: 100 })
  if (!isObject(value)) throw new Error('配置内容必须是 YAML 对象')
  return value
}

function inside(root: string, target: string): boolean {
  const part = relative(root, target)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../')
}

function subscriptionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) ? value : undefined
  } catch {
    return undefined
  }
}

function profileWarnings(config: Record<string, unknown>): string[] {
  const warnings: string[] = []
  if (
    config.mode === 'script' ||
    config.script ||
    (Array.isArray(config.rules) &&
      config.rules.some((rule) => typeof rule === 'string' && /^SCRIPT,/i.test(rule)))
  ) {
    warnings.push(
      '含旧内核 Script 模式或 SCRIPT 规则；Mihomo 不能按客户端 JavaScript 覆写原样执行。导入后须改为规则/规则集，并校验后使用。原文会保留。'
    )
  }
  for (const key of ['proxy-providers', 'rule-providers']) {
    const provider = config[key]
    if (
      isObject(provider) &&
      Object.values(provider).some((value) => isObject(value) && typeof value.path === 'string')
    ) {
      warnings.push(
        `${key} 含资源文件路径。迁移不自动改写外部路径或复制缓存，请在外部资源页检查并更新。`
      )
    }
  }
  if (config.tun || config['mixed-port'] || config.port || config['socks-port']) {
    warnings.push(
      '源文件中的端口/TUN 字段保留；Navio 的客户端级设置仍按当前值控制，不会因迁移自动开启系统代理或 TUN。'
    )
  }
  return warnings
}

/** Read snapshots only. Legacy scripts are never loaded, evaluated or imported as executable code. */
export async function inspectCfwDirectory(directory: string): Promise<CfwMigrationPreview> {
  const root = await realpath(directory)
  if (!(await stat(root)).isDirectory()) throw new Error('请选择 CFW 数据文件夹')
  let totalBytes = 0
  const warnings: string[] = []
  const unsupportedScripts: CfwMigrationPreview['unsupportedScripts'] = []
  const profiles: MigrationPlan['profiles'] = []
  const overrides: MigrationPlan['overrides'] = []
  const overridePreviews: CfwMigrationPreview['overrides'] = []
  const visited = new Set<string>()
  const uid = (): string => randomBytes(12).toString('hex')
  const sourceName = (path: string): string => relative(root, path) || basename(path)
  const readSafe = async (path: string): Promise<string | undefined> => {
    let actual: string
    try {
      actual = await realpath(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (!inside(root, actual)) throw new Error('源文件链接指向所选目录之外，已拒绝读取')
    const info = await stat(actual)
    if (!info.isFile()) throw new Error('源路径不是普通文件')
    if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES)
      throw new Error('源文件超过迁移读取上限')
    totalBytes += info.size
    return readFile(actual, 'utf8')
  }
  const addProfile = async (
    path: string,
    metadata: Record<string, unknown> = {}
  ): Promise<boolean> => {
    if (profiles.length >= MAX_PROFILES) {
      warnings.push('配置数量超过150个，本次只预览前150个。')
      return false
    }
    const normalized = resolve(path)
    if (visited.has(normalized)) return true
    visited.add(normalized)
    try {
      const content = await readSafe(path)
      if (content === undefined) return false
      const config = parseObject(content)
      if (!config.proxies && !config['proxy-groups'] && !config['proxy-providers'] && !config.rules)
        return false
      const url = subscriptionUrl(metadata.url)
      const candidate: CfwMigrationCandidate = {
        id: uid(),
        name: typeof metadata.name === 'string' ? metadata.name.slice(0, 120) : basename(path),
        kind: url ? 'remote' : 'local',
        sourceFile: sourceName(path),
        ...(url ? { sourceHost: new URL(url).hostname } : {}),
        nodeCount: Array.isArray(config.proxies) ? config.proxies.length : 0,
        groupCount: Array.isArray(config['proxy-groups']) ? config['proxy-groups'].length : 0,
        ruleCount: Array.isArray(config.rules) ? config.rules.length : 0,
        warnings: profileWarnings(config)
      }
      if (metadata.url && !url)
        candidate.warnings.push('原订阅地址不是支持的 HTTP(S) 地址，按本地快照导入。')
      if (metadata.selected)
        candidate.warnings.push(
          'CFW 记录的节点选择不会覆盖当前 Navio 节点选择；导入后请在节点页确认。'
        )
      profiles.push({
        candidate,
        content,
        url,
        interval:
          typeof metadata.interval === 'number' && metadata.interval > 0
            ? metadata.interval
            : undefined
      })
      return true
    } catch (error) {
      warnings.push(`${sourceName(path)}：${error instanceof Error ? error.message : '无法读取'}`)
      return false
    }
  }
  const addMixin = (input: unknown, source: string): void => {
    try {
      const parsed = typeof input === 'string' ? parseObject(input) : input
      if (!isObject(parsed)) return
      const value = Object.hasOwn(parsed, 'mixin') ? parsed.mixin : parsed
      if (!isObject(value) || Object.keys(value).length === 0) return
      if (Object.hasOwn(value, 'script') || value.mode === 'script') {
        unsupportedScripts.push({
          source,
          kind: '旧内核 Script',
          message: '此 Mixin 含旧内核 Script，不能作为普通 YAML 自动迁移；请改写为规则/规则集。'
        })
        return
      }
      const overrideId = uid(),
        name = `CFW Mixin · ${basename(source)}`
      overrides.push({ id: overrideId, name, content: stringify(value) })
      overridePreviews.push({ id: overrideId, name, sourceFile: source, keys: Object.keys(value) })
    } catch (error) {
      warnings.push(
        `${source}：Mixin 无法转换，${error instanceof Error ? error.message : '格式无效'}`
      )
    }
  }
  const noteScript = (source: string, kind: string): void => {
    unsupportedScripts.push({
      source,
      kind,
      message:
        '保留原文件，未执行或自动导入。CFW 的 module.exports.parse、url/正则匹配和 yaml/axios/notify 上下文需改写为 Navio 覆写入口后单独审查。'
    })
  }
  const profileDir = basename(root).toLowerCase() === 'profiles' ? root : join(root, 'profiles')
  try {
    const listing =
      (await readSafe(join(profileDir, 'list.yml'))) ??
      (await readSafe(join(profileDir, 'list.yaml')))
    if (listing) {
      const files = parseObject(listing).files
      if (Array.isArray(files)) {
        for (const item of files.slice(0, MAX_PROFILES)) {
          if (!isObject(item)) continue
          const filename = String(item.time ?? item.file ?? item.filename ?? '')
          if (
            !filename ||
            filename.includes('/') ||
            filename.includes('\\') ||
            filename === '.' ||
            filename === '..'
          ) {
            warnings.push('profiles/list.yml 中存在无效或跨目录文件名，已跳过。')
            continue
          }
          let found = false
          for (const suffix of ['', '.yml', '.yaml']) {
            if (await addProfile(join(profileDir, filename + suffix), item)) {
              found = true
              break
            }
          }
          if (!found)
            warnings.push(
              `配置“${String(item.name ?? filename).slice(0, 120)}”没有可用缓存；为避免订阅受限导致误导，本次不联网拉取，请之后手动导入链接。`
            )
        }
      }
    }
  } catch (error) {
    warnings.push(`profiles/list.yml：${error instanceof Error ? error.message : '无法读取'}`)
  }
  try {
    const entries = await readdir(profileDir, { withFileTypes: true })
    for (const entry of entries.slice(0, MAX_PROFILES + 20)) {
      if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        /\.ya?ml$/i.test(entry.name) &&
        !/^list\.ya?ml$/i.test(entry.name)
      )
        await addProfile(join(profileDir, entry.name))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      warnings.push('部分 profiles 目录内容无法读取。')
  }
  if (profiles.length === 0) {
    for (const name of ['config.yaml', 'config.yml'])
      if (await addProfile(join(root, name), { name: 'CFW 配置快照' })) break
  }
  for (const name of ['mixin.yaml', 'mixin.yml']) {
    try {
      const content = await readSafe(join(root, name))
      if (content) addMixin(content, name)
    } catch (error) {
      warnings.push(`${name}：${error instanceof Error ? error.message : '无法读取'}`)
    }
  }
  for (const name of [
    'cfw-settings.yaml',
    'cfw-settings.yml',
    'settings.yaml',
    'settings.yml',
    'settings.json',
    'config.json'
  ]) {
    try {
      const content = await readSafe(join(root, name))
      if (!content) continue
      const settings = parseObject(content)
      const value = isObject(settings.settings) ? settings.settings : settings
      if (typeof value.mixinText === 'string') addMixin(value.mixinText, name + ':mixinText')
      if (typeof value.mixinCode === 'string' && value.mixinCode.trim())
        noteScript(name + ':mixinCode', 'Mixin JavaScript')
      if (value.parsers || value.parser || value.parsersText)
        noteScript(name + ':parsers', 'Parsers')
    } catch (error) {
      warnings.push(`${name}：${error instanceof Error ? error.message : '无法读取'}`)
    }
  }
  for (const name of ['parsers.yaml', 'parsers.yml', 'parsers.js', 'mixin.js']) {
    try {
      const content = await readSafe(join(root, name))
      if (content?.trim())
        noteScript(name, name.startsWith('parsers') ? 'Parsers' : 'Mixin JavaScript')
    } catch (error) {
      warnings.push(`${name}：${error instanceof Error ? error.message : '无法读取'}`)
    }
  }
  warnings.push(
    '迁移只新增独立配置，不切换当前配置、不启动代理、不联网刷新。远程订阅保留原地址并暂时关闭自动更新，之后可在订阅设置中启用。'
  )
  if (overrides.length)
    warnings.push(
      'YAML Mixin 转换为非全局覆写，仅关联本次选择导入的配置。请核对字段后启用相应配置。'
    )
  if (!profiles.length)
    warnings.push('未找到可导入的 YAML 配置；请确认选择的是 CFW 数据目录或 profiles 目录。')
  const planId = uid(),
    preview: CfwMigrationPreview = {
      planId,
      sourceDirectory: root,
      expiresAt: Date.now() + PLAN_LIFETIME_MS,
      candidates: profiles.map((profile) => profile.candidate),
      overrides: overridePreviews,
      warnings,
      unsupportedScripts
    }
  for (const [key, plan] of plans) if (plan.preview.expiresAt < Date.now()) plans.delete(key)
  if (plans.size >= 4) plans.delete(plans.keys().next().value as string)
  plans.set(planId, { preview, profiles, overrides })
  return structuredClone(preview)
}

export async function previewCfwMigration(): Promise<CfwMigrationPreview | null> {
  const selection = await dialog.showOpenDialog({
    title: '选择 Clash for Windows 数据文件夹',
    properties: ['openDirectory']
  })
  if (selection.canceled || !selection.filePaths[0]) return null
  return inspectCfwDirectory(selection.filePaths[0])
}

export async function applyCfwMigration(
  planId: string,
  selection: CfwMigrationSelection = {}
): Promise<CfwMigrationResult> {
  const plan = plans.get(planId)
  if (!plan || plan.preview.expiresAt < Date.now()) {
    plans.delete(planId)
    throw new Error('迁移预览已过期，请重新选择并核对')
  }
  const profileIds = selection.profileIds ?? plan.profiles.map((profile) => profile.candidate.id)
  const overrideIds = selection.overrideIds ?? plan.overrides.map((override) => override.id)
  if (
    !Array.isArray(profileIds) ||
    !Array.isArray(overrideIds) ||
    profileIds.some((id) => !plan.profiles.some((profile) => profile.candidate.id === id)) ||
    overrideIds.some((id) => !plan.overrides.some((override) => override.id === id))
  )
    throw new Error('迁移选择不在已预览清单中')
  const chosen = plan.profiles.filter((profile) => profileIds.includes(profile.candidate.id))
  if (!chosen.length) throw new Error('请至少选择一个配置')
  plans.delete(planId)
  const result: CfwMigrationResult = {
    importedProfiles: [],
    importedOverrides: [],
    warnings: [...plan.preview.warnings]
  }
  const attached: string[] = []
  for (const override of plan.overrides.filter((item) => overrideIds.includes(item.id))) {
    const id = `cfw-${randomBytes(12).toString('hex')}`
    try {
      await addOverrideItem({
        id,
        type: 'local',
        ext: 'yaml',
        name: override.name,
        global: false,
        file: override.content
      })
      attached.push(id)
      result.importedOverrides.push({ id, name: override.name })
    } catch {
      result.warnings.push(`覆写“${override.name}”导入失败；对应配置未关联此覆写，请重试。`)
    }
  }
  for (const profile of chosen) {
    const id = `cfw-${randomBytes(12).toString('hex')}`,
      name = `${profile.candidate.name} · CFW`
    try {
      await setProfileStr(id, profile.content)
      await updateProfileConfig((config) => ({
        ...config,
        items: [
          ...config.items,
          {
            id,
            type: profile.url ? 'remote' : 'local',
            name,
            ...(profile.url ? { url: profile.url } : {}),
            autoUpdate: false,
            interval: profile.interval || 0,
            override: attached,
            updated: Date.now()
          }
        ]
      }))
      result.importedProfiles.push({ id, name })
      result.warnings.push(...profile.candidate.warnings.map((warning) => `${name}：${warning}`))
    } catch {
      result.warnings.push(`配置“${name}”导入失败；原文件和当前配置未修改，请重新预览后重试。`)
    }
  }
  result.warnings.push(
    ...plan.preview.unsupportedScripts.map((script) => `${script.source}：${script.message}`)
  )
  return result
}
