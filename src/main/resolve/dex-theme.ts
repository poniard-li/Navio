import path from 'path'
import { createHash } from 'crypto'
import { dialog, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import {
  officialThemeDefinition,
  type OfficialThemeSettings,
  type ThemeTrialState
} from '../../shared/official-themes'
import { ThemeService } from '../dex-legacy/theme-service.cjs'
import {
  DEX_THEME_ACTIONS,
  dexThemeCss,
  validateDexTheme,
  type DexTheme,
  type DexThemeCatalog
} from '../../shared/dex-theme'
import { dataDir } from '../utils/dirs'
import { mainWindow } from '../window'
import { getAppConfig, patchAppConfig } from '../config'
import { themeAssets, type ThemeAsset } from '../../shared/theme-media'
import { OfficialThemeStore } from './official-themes'
import { applyTheme, writeTheme } from './theme'
import { dexAccountRequest, dexServerUrl, setDexServerUrl } from './dex-account'
import {
  ensureThemeAssets,
  importThemeMedia,
  importThemePackage,
  exportThemePackage,
  readThemeAsset,
  pruneThemeMedia
} from './theme-media'

let officialLibrary: OfficialThemeStore | undefined
let trial: { theme: DexTheme; settings: Record<string, OfficialThemeSettings> } | undefined
function officialService(): OfficialThemeStore {
  return (officialLibrary ??= new OfficialThemeStore(
    path.join(dataDir(), 'dex-library', 'official')
  ))
}
function trialState(): ThemeTrialState | null {
  return trial
    ? {
        id: trial.theme.id,
        name: trial.theme.name,
        official: !!officialThemeDefinition(trial.theme.id)
      }
    : null
}
async function officialAppearance(id: string, input?: unknown): Promise<'dark' | 'light'> {
  const settings = await officialService().settings(id)
  return settings.appearance === 'system'
    ? input === 'dark' || input === 'light'
      ? input
      : nativeTheme?.shouldUseDarkColors === false
        ? 'light'
        : 'dark'
    : settings.appearance
}
let library: ThemeService | undefined
let previewKey: string | undefined
let previewTheme: DexTheme | undefined
let operationQueue: Promise<unknown> = Promise.resolve()
function service(): ThemeService {
  library ??= new ThemeService({
    userData: path.join(dataDir(), 'dex-library'),
    dialog,
    getWindow: () => mainWindow || undefined
  })
  return library
}
async function clearPreview(resumeTrial = true): Promise<void> {
  if (previewKey && mainWindow && !mainWindow.isDestroyed())
    await mainWindow.webContents.removeInsertedCSS(previewKey).catch(() => {})
  previewKey = undefined
  previewTheme = undefined
  if (resumeTrial && trial) {
    await showPreview(trial.theme)
    return
  }
  mainWindow?.webContents.send('dexThemeBackground', null)
}
async function showPreview(theme: DexTheme): Promise<void> {
  await clearPreview(false)
  if (mainWindow && !mainWindow.isDestroyed())
    previewKey = await mainWindow.webContents.insertCSS(dexThemeCss(theme))
  previewTheme = theme
  mainWindow?.webContents.send('dexThemeBackground', theme)
}
async function downloadAsset(asset: ThemeAsset): Promise<Uint8Array> {
  return (await dexAccountRequest(
    `/api/v1/theme-assets/${asset.sha256}`,
    { signal: AbortSignal.timeout(120000) },
    true,
    asset.size
  )) as Uint8Array
}
async function uploadAssets(theme: DexTheme): Promise<void> {
  for (const asset of themeAssets(theme))
    await dexAccountRequest(`/api/v1/theme-assets/${asset.sha256}`, {
      method: 'PUT',
      headers: { 'Content-Type': asset.mime },
      body: new Uint8Array(await readThemeAsset(asset)),
      signal: AbortSignal.timeout(120000)
    })
}
async function catalog(): Promise<DexThemeCatalog> {
  const result = await service().list()
  result.serverUrl = await dexServerUrl()
  const config = await getAppConfig()
  result.selectedId = /^dex-([a-z][a-z0-9-]{2,47})\.css$/.exec(config.customTheme || '')?.[1] || ''
  return result
}
async function execute(action: string, payload: Record<string, unknown>): Promise<unknown> {
  if (action === 'list') return catalog()
  if (action === 'officialCatalog')
    return {
      themes: await officialService().list(),
      activeId: (await catalog()).selectedId,
      trial: trialState()
    }
  if (action === 'trialState') return trialState()
  if (action === 'installOfficial') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    await officialService().install(payload.id)
    return { ok: true }
  }
  if (action === 'removeOfficial') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    if (trial?.theme.id === payload.id || (await catalog()).selectedId === payload.id)
      throw new Error('请先切换到其他主题')
    await officialService().remove(payload.id)
    return { ok: true }
  }
  if (action === 'officialFavorite') {
    if (typeof payload.id !== 'string' || typeof payload.favorite !== 'boolean')
      throw new Error('收藏参数无效')
    await officialService().favorite(payload.id, payload.favorite)
    return { ok: true }
  }
  if (action === 'officialSettings') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    const settings = await officialService().settings(payload.id, payload.settings)
    if (payload.settings !== undefined) {
      if (trial?.theme.id === payload.id) {
        trial.theme = await officialService().theme(
          payload.id,
          await officialAppearance(payload.id, payload.appearance)
        )
        await showPreview(trial.theme)
      } else if ((await catalog()).selectedId === payload.id)
        await execute('apply', { id: payload.id, appearance: payload.appearance })
      mainWindow?.webContents.send('dexThemeBackground', null)
    }
    return settings
  }
  if (action === 'trial') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    let theme: DexTheme
    if (officialThemeDefinition(payload.id))
      theme = await officialService().theme(
        payload.id,
        await officialAppearance(payload.id, payload.appearance)
      )
    else theme = validateDexTheme(await service().find(payload.id))
    await ensureThemeAssets(theme, downloadAsset)
    const previous = trial?.settings || (await officialService().preferences()).settings
    await showPreview(theme)
    trial = { theme, settings: structuredClone(previous) }
    mainWindow?.webContents.send('dexThemeBackground', theme)
    return trialState()
  }
  if (action === 'restoreTrial') {
    if (trial) await officialService().restoreSettings(trial.settings)
    trial = undefined
    await clearPreview(false)
    return { ok: true }
  }
  if (action === 'keepTrial') {
    if (!trial) throw new Error('当前没有正在试用的主题')
    const selected = trial
    try {
      await execute('apply', { id: selected.theme.id, appearance: selected.theme.appearance })
      trial = undefined
      await clearPreview(false)
    } catch (error) {
      trial = selected
      await showPreview(selected.theme)
      throw error
    }
    return { ok: true }
  }
  if (action === 'activeBackground') {
    if (previewTheme) return previewTheme
    const selected = /^dex-([a-z][a-z0-9-]{2,47})\.css$/.exec(
      (await getAppConfig()).customTheme || ''
    )?.[1]
    if (selected && officialThemeDefinition(selected))
      return officialService()
        .theme(selected, await officialAppearance(selected))
        .catch(() => null)
    return selected
      ? service()
          .find(selected)
          .catch(() => null)
      : null
  }
  if (action === 'importMedia') return importThemeMedia(payload.kind)
  if (action === 'pruneMedia')
    return {
      removed: await pruneThemeMedia([
        ...(await service().list()).local,
        ...(previewTheme ? [previewTheme] : [])
      ])
    }
  if (action === 'loadMedia') {
    const theme = validateDexTheme(payload.theme)
    await ensureThemeAssets(theme, downloadAsset)
    return { ok: true }
  }
  if (action === 'import') {
    const theme = await importThemePackage()
    if (theme && officialThemeDefinition(theme.id))
      throw new Error('官方主题标识已保留，请修改主题 ID 后导入')
    return theme ? service().save({ theme }) : null
  }
  if (action === 'export') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    const theme = validateDexTheme(await service().find(payload.id))
    if (!themeAssets(theme).length) return service().handle('themes.export', payload)
    await ensureThemeAssets(theme, downloadAsset)
    return exportThemePackage(theme)
  }
  if (action === 'editPublication' || action === 'reviewPublication') {
    const publications = (await dexAccountRequest('/api/v1/account/themes')) as {
      themes: { id: string; theme: unknown; status: string }[]
    }
    const item = publications.themes.find((entry) => entry.id === payload.id)
    if (!item) throw new Error('只能修改或复核自己的作品')
    const remote = validateDexTheme(item.theme)
    await ensureThemeAssets(remote, downloadAsset)
    if (action === 'editPublication') {
      const local = (await service().list()).local.find((theme) => theme.id === remote.id)
      return local || service().save({ theme: remote })
    }
    if (item.status !== 'removed') throw new Error('此作品不需要提交复核，或已经在等待复核')
    const theme = validateDexTheme(await service().find(remote.id))
    await uploadAssets(theme)
    return dexAccountRequest('/api/v1/themes', {
      method: 'POST',
      body: JSON.stringify({ theme, submitReview: true })
    })
  }
  if (action === 'installCloud') {
    const id = payload.id
    if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw new Error('主题标识无效')
    const result = (await dexAccountRequest(`/api/v1/themes/${id}`)) as { item: { theme: unknown } }
    const theme = validateDexTheme(result.item.theme)
    await ensureThemeAssets(theme, downloadAsset)
    theme.id = `cloud-${createHash('sha256')
      .update(`${await dexServerUrl()}/${id}`)
      .digest('hex')
      .slice(0, 32)}`
    await service().save({ theme })
    return execute('apply', { id: theme.id })
  }
  if (action === 'cancelPreview') {
    await clearPreview()
    return { ok: true }
  }
  if (action === 'preview') {
    const theme = validateDexTheme(payload.theme)
    const css = dexThemeCss(theme)
    await ensureThemeAssets(theme)
    await clearPreview(false)
    if (mainWindow && !mainWindow.isDestroyed())
      previewKey = await mainWindow.webContents.insertCSS(css)
    previewTheme = theme
    mainWindow?.webContents.send('dexThemeBackground', theme)
    return { ok: true }
  }
  if (action === 'apply') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    if (payload.source === 'remote') {
      const remote = (await service().list()).remote.find((theme) => theme.id === payload.id)
      if (!remote) throw new Error('远程主题已不在当前目录中，请刷新后重试')
      await service().save({ theme: validateDexTheme(remote) })
    }
    const official = officialThemeDefinition(payload.id)
    const theme = official
      ? await officialService().theme(
          payload.id,
          await officialAppearance(payload.id, payload.appearance)
        )
      : validateDexTheme(await service().find(payload.id))
    await ensureThemeAssets(theme, downloadAsset)
    const filename = `dex-${theme.id}.css`
    const config = await getAppConfig()
    const previous = { customTheme: config.customTheme || 'default.css', appTheme: config.appTheme }
    await writeTheme(filename, dexThemeCss(theme))
    try {
      await patchAppConfig({
        customTheme: filename,
        appTheme: official
          ? (await officialService().settings(payload.id)).appearance
          : theme.appearance
      })
      await clearPreview(false)
      await applyTheme(filename)
      if (!official) await service().apply({ id: theme.id })
    } catch (error) {
      await patchAppConfig(previous)
      await applyTheme(previous.customTheme)
      throw error
    }
    trial = undefined
    mainWindow?.webContents.send('appConfigUpdated')
    mainWindow?.webContents.send('dexThemeBackground', null)
    return theme
  }
  if (action === 'save') {
    const theme = validateDexTheme(payload.theme)
    if (officialThemeDefinition(theme.id)) throw new Error('请将官方主题另存为自己的设计')
    await ensureThemeAssets(theme, downloadAsset)
    return service().save({ theme })
  }
  if (action === 'configure') {
    if (typeof payload.url !== 'string') throw new Error('账号服务地址无效')
    await setDexServerUrl(payload.url)
    return catalog()
  }
  if (action === 'refresh') {
    try {
      const themes: ReturnType<typeof validateDexTheme>[] = []
      const seen = new Set<string>()
      const origin = await dexServerUrl()
      for (let page = 1; page <= 100; page++) {
        const data = (await dexAccountRequest(`/api/v1/themes?page=${page}`, {}, true)) as {
          themes: { id: string; theme: unknown }[]
          total: number
        }
        if (!Array.isArray(data.themes) || !Number.isSafeInteger(data.total) || data.total < 0)
          throw new Error('主题库返回了无效目录')
        for (const item of data.themes) {
          if (typeof item.id !== 'string') throw new Error('主题缺少发布标识')
          if (seen.has(item.id)) continue
          seen.add(item.id)
          const theme = validateDexTheme(item.theme)
          // Cloud publication IDs identify the author as well as the theme;
          // two authors may legitimately choose the same local theme ID.
          theme.id = `cloud-${createHash('sha256').update(`${origin}/${item.id}`).digest('hex').slice(0, 32)}`
          themes.push(theme)
        }
        if (!data.themes.length || page * 40 >= data.total) break
        if (page === 100) throw new Error('主题目录过大，请稍后重试或联系管理员。')
      }
      await service().setRemote(themes)
    } catch (error) {
      await service().setRemote(null, String(error))
    }
    return catalog()
  }
  if (action === 'publish') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    const theme = validateDexTheme(await service().find(payload.id))
    if ((await service().list()).builtins.some((item) => item.id === theme.id))
      throw new Error('请先另存为自己的主题再发布')
    await uploadAssets(theme)
    const result = (await dexAccountRequest('/api/v1/themes', {
      method: 'POST',
      body: JSON.stringify({ theme })
    })) as { item: { theme: unknown } }
    return validateDexTheme(result.item.theme)
  }
  return service().handle(`themes.${action}`, payload)
}

/** This feature accepts only its explicit operations from the app's top-level renderer. */
export function dexThemes(
  event: IpcMainInvokeEvent,
  action: unknown,
  payload: unknown = {}
): Promise<unknown> {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  )
    return Promise.reject(new Error('无效的主题操作来源'))
  if (typeof action !== 'string' || !(DEX_THEME_ACTIONS as readonly string[]).includes(action))
    return Promise.reject(new Error('不支持的主题操作'))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return Promise.reject(new Error('主题参数格式无效'))
  const run = () => execute(action, payload as Record<string, unknown>)
  const result = operationQueue.then(run, run)
  operationQueue = result.catch(() => {})
  return result
}
