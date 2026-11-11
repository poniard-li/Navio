import { createHash, randomUUID } from 'crypto'
import { open, rename, rm } from 'fs/promises'
import { app, dialog, BrowserWindow, shell } from 'electron'
import { isPortable } from '../utils/dirs'
import { dexAccountRequest, dexServerUrl } from './dex-account'
import { fetchReleaseAsset } from './release-download'

interface Release {
  version: string
  notes: string
  url: string
  sha256: string
  size: number
}
let available: Release | undefined
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
  )) as { release: Release | null }
  if (data.release) releaseTag(data.release.version)
  if (!data.release || !newerVersion(data.release.version, app.getVersion())) {
    available = undefined
    return undefined
  }
  if (
    !/^[a-f0-9]{64}$/i.test(data.release.sha256) ||
    !Number.isSafeInteger(data.release.size) ||
    data.release.size < 1 ||
    data.release.size > 1024 ** 3
  )
    throw new Error('更新清单缺少有效的文件校验信息。')
  available = data.release
  return { version: available.version, changelog: available.notes }
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  if (downloading) throw new Error('已有更新正在下载。')
  if (!available || available.version !== version) {
    await checkUpdate()
  }
  const release = available
  if (!release || release.version !== version) throw new Error('此更新已变更，请重新检查。')
  if (!isPortable()) {
    const tag = releaseTag(release.version)
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '更新 Navio',
      message: `下载 Navio ${release.version} 安装包`,
      detail:
        '在此版本发布页下载 Windows x64 的 setup.exe 安装包，从系统托盘退出 Navio 后运行。安装版配置保存在 %APPDATA%\\DEX-STUDIO-NEXT，更新后继续保留。',
      buttons: ['打开发布页', '取消'],
      defaultId: 0,
      cancelId: 1
    })
    if (result.response === 0)
      await shell.openExternal(`https://github.com/poniard-li/Navio/releases/tag/${tag}`)
    return
  }
  const server = await dexServerUrl(),
    url = new URL(release.url, server)
  if (url.protocol !== 'https:' && url.origin !== server)
    throw new Error('下载地址必须使用 HTTPS。')
  const result = await dialog.showSaveDialog({
    title: '下载 Navio 免安装更新包',
    defaultPath: `Navio-${version.replace(/[^\w.-]/g, '')}-Windows-x64.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return
  const temporary = `${result.filePath}.${randomUUID()}.part`
  downloading = true
  try {
    const response = await fetchReleaseAsset(url, server, AbortSignal.timeout(20 * 60 * 1000))
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
        if (size > release.size) throw new Error('更新包大小与发布清单不一致。')
        hash.update(chunk)
        await file.writeFile(chunk)
        progress({ status: 'downloading', percent: Math.round((size / release.size) * 100) })
      }
      progress({ status: 'verifying' })
      if (size !== release.size || hash.digest('hex') !== release.sha256.toLowerCase())
        throw new Error('更新包校验失败，未执行更新。')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, result.filePath)
    shell.showItemInFolder(result.filePath)
    await dialog.showMessageBox({
      type: 'info',
      title: '更新包已下载并通过校验',
      message: '当前为免安装公测版，请退出 Navio 后解压新版。',
      detail:
        '将原目录中的 DEX-STUDIO-NEXT 数据文件夹复制到新版目录，可保留本机设置。不要覆盖正在运行的程序。',
      buttons: ['知道了']
    })
  } finally {
    downloading = false
    await rm(temporary, { force: true }).catch(() => {})
  }
}
