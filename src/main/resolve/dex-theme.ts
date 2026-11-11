import path from 'path'
import { createHash } from 'crypto'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import { ThemeService } from '../dex-legacy/theme-service.cjs'
import {
  DEX_THEME_ACTIONS,
  dexThemeCss,
  validateDexTheme,
  type DexThemeCatalog
} from '../../shared/dex-theme'
import { dataDir } from '../utils/dirs'
import { mainWindow } from '../window'
import { getAppConfig, patchAppConfig } from '../config'
import { applyTheme, writeTheme } from './theme'
import { dexAccountRequest, dexServerUrl, setDexServerUrl } from './dex-account'

let library: ThemeService | undefined
let previewKey: string | undefined
let operationQueue: Promise<unknown> = Promise.resolve()
function service(): ThemeService {
  library ??= new ThemeService({
    userData: path.join(dataDir(), 'dex-library'),
    dialog,
    getWindow: () => mainWindow || undefined
  })
  return library
}
async function clearPreview(): Promise<void> {
  if (previewKey && mainWindow && !mainWindow.isDestroyed())
    await mainWindow.webContents.removeInsertedCSS(previewKey).catch(() => {})
  previewKey = undefined
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
  if (action === 'cancelPreview') {
    await clearPreview()
    return { ok: true }
  }
  if (action === 'preview') {
    const css = dexThemeCss(payload.theme)
    await clearPreview()
    if (mainWindow && !mainWindow.isDestroyed())
      previewKey = await mainWindow.webContents.insertCSS(css)
    return { ok: true }
  }
  if (action === 'apply') {
    if (typeof payload.id !== 'string') throw new Error('请选择主题')
    if (payload.source === 'remote') {
      const remote = (await service().list()).remote.find((theme) => theme.id === payload.id)
      if (!remote) throw new Error('远程主题已不在当前目录中，请刷新后重试')
      await service().save({ theme: validateDexTheme(remote) })
    }
    const theme = validateDexTheme(await service().find(payload.id))
    const filename = `dex-${theme.id}.css`
    const config = await getAppConfig()
    const previous = { customTheme: config.customTheme || 'default.css', appTheme: config.appTheme }
    await writeTheme(filename, dexThemeCss(theme))
    try {
      await patchAppConfig({ customTheme: filename, appTheme: theme.appearance })
      await clearPreview()
      await applyTheme(filename)
      await service().apply({ id: theme.id })
    } catch (error) {
      await patchAppConfig(previous)
      await applyTheme(previous.customTheme)
      throw error
    }
    mainWindow?.webContents.send('appConfigUpdated')
    return theme
  }
  if (action === 'save') {
    return service().save({ theme: validateDexTheme(payload.theme) })
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
        if (page === 100) throw new Error('目录较大，请在账号门户搜索主题。')
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
