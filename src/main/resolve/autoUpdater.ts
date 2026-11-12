import { createHash } from 'crypto'
import { mkdtemp, open, rename, rm } from 'fs/promises'
import path from 'path'
import { app, dialog, BrowserWindow } from 'electron'
import { isPortable, exeDir } from '../utils/dirs'
import { formatProductVersion } from '../../shared/product'
import { dexAccountRequest, dexServerUrl } from './dex-account'
import { fetchReleaseAsset } from './release-download'
import { selectUpdateArtifact, stagePortableUpdate, type UpdateRelease } from './update-package'
import { startUpdateRunner, updateSiblingPaths } from './update-runner'
let available: UpdateRelease | undefined
let downloading = false
function releaseTag(version: string): string {
  if (
    typeof version !== 'string' ||
    version.length > 100 ||
    !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version
    )
  )
    throw new Error('更新清单中的版本号无效。')
  return `v${version.replace(/^v/, '')}`
}

export function newerVersion(candidate: string, installed: string): boolean {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : -1))
  const next = parse(candidate),
    current = parse(installed)
  for (let i = 0; i < Math.max(next.length, current.length); i++) {
    const a = next[i] ?? Infinity,
      b = current[i] ?? Infinity
    if (a !== b) return a > b
  }
  return false
}
export async function checkUpdate(): Promise<IAppVersion | undefined> {
  const data = (await dexAccountRequest(
    '/api/v1/releases/latest?product=navio&channel=beta&platform=win32-x64',
    {},
    false
  )) as { release: UpdateRelease | null }
  if (data.release) releaseTag(data.release.version)
  if (!data.release || !newerVersion(data.release.version, app.getVersion())) {
    available = undefined
    return undefined
  }
  available = data.release
  return { version: available.version, changelog: available.notes }
}
export async function downloadAndInstallUpdate(version: string): Promise<void> {
  if (downloading) throw new Error('已有更新正在下载或准备安装。')
  downloading = true
  let directory: string | undefined
  let stage: string | undefined
  let handedOff = false
  try {
    if (!available || available.version !== version) await checkUpdate()
    const release = available
    if (!release || release.version !== version) throw new Error('此更新已变更，请重新检查。')
    const portable = isPortable(),
      artifact = selectUpdateArtifact(release, portable)
    directory = await mkdtemp(path.join(app.getPath('temp'), 'navio-update-'))
    const filePath = path.join(directory, portable ? 'Navio.zip' : 'Navio-setup.exe'),
      temporary = filePath + '.part'
    const response = await fetchReleaseAsset(
      new URL(artifact.url),
      await dexServerUrl(),
      AbortSignal.timeout(20 * 60 * 1000)
    )
    if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`)
    const file = await open(temporary, 'wx'),
      hash = createHash('sha256')
    let size = 0
    const progress = (state: object): void => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('updateDownloadProgress', state)
    }
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > artifact.size) throw new Error('更新包大小与发布清单不一致。')
        hash.update(chunk)
        await file.writeFile(chunk)
        progress({ status: 'downloading', percent: Math.round((size / artifact.size) * 100) })
      }
      progress({ status: 'verifying' })
      if (size !== artifact.size || hash.digest('hex') !== artifact.sha256.toLowerCase())
        throw new Error('更新包校验失败，未执行更新。')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, filePath)
    const target = exeDir(),
      siblings = updateSiblingPaths(target)
    if (portable) {
      stage = siblings.stage
      await stagePortableUpdate(filePath, stage)
    }
    const confirmation = await dialog.showMessageBox({
      type: 'info',
      title: '安装 Navio 更新',
      message: `Navio ${formatProductVersion(version)} 已下载并通过校验`,
      detail: portable
        ? '现在退出并更新，完成后自动重启。本机数据会保留，原程序将留在相邻的 Navio-before-update 文件夹中。更新期间连接会暂时中断。'
        : '现在退出并安装到原目录，完成后自动重启。本机设置和订阅会保留，更新期间连接会暂时中断。',
      buttons: ['退出并更新', '暂不更新'],
      defaultId: 0,
      cancelId: 1
    })
    if (confirmation.response !== 0) return
    await startUpdateRunner(
      {
        pid: process.pid,
        kind: portable ? 'portable' : 'installer',
        target,
        stage: stage || '',
        backup: siblings.backup,
        package: filePath,
        sha256: artifact.sha256.toLowerCase(),
        version
      },
      directory
    )
    handedOff = true
    app.quit()
  } finally {
    if (!handedOff) {
      downloading = false
      if (stage) await rm(stage, { recursive: true, force: true }).catch(() => {})
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }
}
