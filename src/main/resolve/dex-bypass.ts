import { BrowserWindow, ipcMain } from 'electron'
import { normalizeBypass, type DexBypassConfig } from '../../shared/dex-bypass'
import { getAppConfig, patchAppConfig } from '../config/app'
import { mihomoHotReloadConfig } from '../core/mihomoApi'
import { WriteQueue } from '../utils/safeFile'

const queue = new WriteQueue()

export async function saveDexBypass(value: unknown): Promise<DexBypassConfig> {
  const next = normalizeBypass(value)
  return queue.run(async () => {
    const previous = normalizeBypass((await getAppConfig()).dexBypass)
    await patchAppConfig({ dexBypass: next })
    try {
      await mihomoHotReloadConfig()
    } catch (error) {
      await patchAppConfig({ dexBypass: previous })
      try {
        await mihomoHotReloadConfig()
      } catch (restoreError) {
        throw new Error(
          `例外未能应用，恢复内核也未成功，请重启内核：${String(error)}；${String(restoreError)}`
        )
      }
      throw new Error(`例外未能应用，已恢复原设置：${String(error)}`)
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('appConfigUpdated')
      window.webContents.send('groupsUpdated')
      window.webContents.send('rulesUpdated')
    }
    ipcMain.emit('updateTrayMenu')
    return next
  })
}
