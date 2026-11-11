import { BrowserWindow } from 'electron'
import type { OperationMode } from '../../shared/simple-config'
import { patchAppConfig } from '../config/app'
import { WriteQueue } from '../utils/safeFile'
const queue = new WriteQueue()
// Both presentation modes share the same subscription and core configuration.
export async function setOperationMode(mode: OperationMode): Promise<void> {
  if (!['standard', 'simple'].includes(mode)) throw new Error('未知界面模式')
  await queue.run(async () => {
    await patchAppConfig({ operationMode: mode, modeSelected: true })
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('appConfigUpdated')
  })
}
