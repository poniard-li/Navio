import path from 'path'
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
  if (action === 'configure' || action === 'refresh') {
    await service().handle(`themes.${action}`, payload)
    return catalog()
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
