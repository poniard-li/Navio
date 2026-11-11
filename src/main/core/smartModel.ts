import { copyFile, open, rename, stat, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { mihomoWorkDir, mihomoTestDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'
import { downloadGitHubAsset } from '../utils/github'
import { withProfileCheckLock } from './check-profile'

const MODEL_FILE = 'Model.bin'

const MODEL_BASE_URL = 'https://github.com/vernesong/mihomo/releases/download/LightGBM-Model'

// 内核在 HomeDir 里只认死 Model.bin 这个文件名，三种尺寸下载后都要落成同一个名字。
const MODEL_ASSETS: Record<SmartModelVariant, string> = {
  standard: 'Model.bin',
  middle: 'Model-middle.bin',
  large: 'Model-large.bin'
}

// 检查文件头尾以识别中断的下载，避免将整个模型读入内存。
// 此检查不解析模型内容；完整格式由内核加载时验证。
const MODEL_PROBE_SIZE = 64
const MODEL_HEADER = 'tree'
const MODEL_FOOTER = '[/target_enhance]'

async function modelLooksComplete(filePath: string, size: number): Promise<boolean> {
  if (size <= MODEL_PROBE_SIZE * 2) return false
  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(MODEL_PROBE_SIZE)
    const tail = Buffer.alloc(MODEL_PROBE_SIZE)
    await handle.read(head, 0, MODEL_PROBE_SIZE, 0)
    await handle.read(tail, 0, MODEL_PROBE_SIZE, size - MODEL_PROBE_SIZE)
    return (
      head.toString('latin1').startsWith(MODEL_HEADER) &&
      tail.toString('latin1').trimEnd().endsWith(MODEL_FOOTER)
    )
  } finally {
    await handle.close()
  }
}

async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

// 配置检查使用独立目录。复用工作目录中的模型，避免每次检查都重新下载。
export async function syncSmartModelToTestDir(targetDir = mihomoTestDir()): Promise<void> {
  const source = path.join(mihomoWorkDir(), MODEL_FILE)
  if (!existsSync(source)) return

  const target = path.join(targetDir, MODEL_FILE)
  if (existsSync(target) && !(await isSourceNewer(source, target))) return

  try {
    await copyFile(source, target)
  } catch (error) {
    managerLogger.warn('Failed to sync Model.bin into test dir', error)
  }
}

export async function getSmartModelStatus(): Promise<ISmartModelStatus> {
  const target = path.join(mihomoWorkDir(), MODEL_FILE)
  try {
    const stats = await stat(target)
    return {
      state: (await modelLooksComplete(target, stats.size)) ? 'ready' : 'damaged',
      size: stats.size,
      modified: stats.mtimeMs
    }
  } catch {
    return { state: 'missing', size: 0 }
  }
}

// 下载到临时文件，检查完整性后再改名替换；下载或检查失败时保留原模型。
export async function downloadSmartModel(variant: SmartModelVariant): Promise<ISmartModelStatus> {
  const target = path.join(mihomoWorkDir(), MODEL_FILE)
  const temp = `${target}.download`

  try {
    await downloadGitHubAsset(`${MODEL_BASE_URL}/${MODEL_ASSETS[variant]}`, temp)
    const { size } = await stat(temp)
    if (!(await modelLooksComplete(temp, size))) {
      throw new Error('Downloaded Smart model is incomplete')
    }
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    managerLogger.warn('Failed to download Model.bin', error)
    throw error
  }

  await withProfileCheckLock(mihomoTestDir(), () => syncSmartModelToTestDir())
  return getSmartModelStatus()
}
