import { createHash } from 'crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  portable: vi.fn(),
  accountRequest: vi.fn(),
  serverUrl: vi.fn(),
  fetchAsset: vi.fn(),
  saveDialog: vi.fn(),
  messageBox: vi.fn(),
  openExternal: vi.fn(),
  showInFolder: vi.fn(),
  progress: vi.fn()
}))
vi.mock('../utils/dirs', () => ({ isPortable: mocks.portable }))
vi.mock('./dex-account', () => ({
  dexAccountRequest: mocks.accountRequest,
  dexServerUrl: mocks.serverUrl
}))
vi.mock('./release-download', () => ({ fetchReleaseAsset: mocks.fetchAsset }))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.6.0-beta.2' },
  dialog: { showSaveDialog: mocks.saveDialog, showMessageBox: mocks.messageBox },
  shell: { openExternal: mocks.openExternal, showItemInFolder: mocks.showInFolder },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.progress } }] }
}))

const payload = 'portable archive fixture'
const release = {
  version: '0.6.0-beta.3',
  notes: '修复配置检查',
  url: 'https://github.com/poniard-li/Navio/releases/download/v0.6.0-beta.3/Navio.zip',
  sha256: createHash('sha256').update(payload).digest('hex'),
  size: Buffer.byteLength(payload)
}
let directory: string | undefined

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.portable.mockReturnValue(false)
  mocks.accountRequest.mockResolvedValue({ release: { ...release } })
  mocks.serverUrl.mockResolvedValue('https://navio.mydex.top')
  mocks.messageBox.mockResolvedValue({ response: 0 })
  mocks.openExternal.mockResolvedValue(undefined)
  mocks.fetchAsset.mockImplementation(async () => new Response(payload))
})
afterEach(async () => {
  if (directory) {
    expect(path.dirname(directory)).toBe(path.resolve(tmpdir()))
    expect(path.basename(directory)).toMatch(/^navio-update-test-/)
    await rm(directory, { recursive: true, force: true })
    directory = undefined
  }
})

describe('updates for installed and portable Navio', () => {
  it('opens the exact installed release page without downloading the portable URL', async () => {
    const updater = await import('./autoUpdater')
    await updater.downloadAndInstallUpdate(release.version)

    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://github.com/poniard-li/Navio/releases/tag/v0.6.0-beta.3'
    )
    expect(mocks.messageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('%APPDATA%\\DEX-STUDIO-NEXT')
      })
    )
    expect(mocks.fetchAsset).not.toHaveBeenCalled()
    expect(mocks.saveDialog).not.toHaveBeenCalled()
    expect(mocks.serverUrl).not.toHaveBeenCalled()
  })

  it('does not open the release page when the user cancels', async () => {
    mocks.messageBox.mockResolvedValue({ response: 1 })
    const updater = await import('./autoUpdater')
    await updater.downloadAndInstallUpdate(release.version)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it.each(['0.6.0-beta.3/../../other', '0.6.0-beta.3?download=evil', 'https://evil.example'])(
    'rejects an unsafe release version before opening a browser: %s',
    async (version) => {
      mocks.accountRequest.mockResolvedValue({ release: { ...release, version } })
      const updater = await import('./autoUpdater')
      await expect(updater.downloadAndInstallUpdate(version)).rejects.toThrow('版本号无效')
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(mocks.saveDialog).not.toHaveBeenCalled()
    }
  )

  it('retains the verified ZIP download and local-data instructions for portable users', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'navio-update-test-'))
    const target = path.join(directory, 'Navio.zip')
    mocks.portable.mockReturnValue(true)
    mocks.saveDialog.mockResolvedValue({ canceled: false, filePath: target })
    const updater = await import('./autoUpdater')
    await updater.downloadAndInstallUpdate(release.version)

    expect(await readFile(target, 'utf8')).toBe(payload)
    expect(await readdir(directory)).toEqual(['Navio.zip'])
    expect(mocks.fetchAsset).toHaveBeenCalledWith(
      new URL(release.url),
      'https://navio.mydex.top',
      expect.any(AbortSignal)
    )
    expect(mocks.showInFolder).toHaveBeenCalledWith(target)
    expect(mocks.messageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('原目录中的 DEX-STUDIO-NEXT')
      })
    )
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it.each(['checksum', 'size'])(
    'rejects a portable %s mismatch without replacing an existing file',
    async (mismatch) => {
      directory = await mkdtemp(path.join(tmpdir(), 'navio-update-test-'))
      const target = path.join(directory, 'Navio.zip')
      await writeFile(target, 'existing download')
      mocks.portable.mockReturnValue(true)
      mocks.saveDialog.mockResolvedValue({ canceled: false, filePath: target })
      mocks.accountRequest.mockResolvedValue({
        release: {
          ...release,
          ...(mismatch === 'checksum' ? { sha256: '0'.repeat(64) } : { size: release.size - 1 })
        }
      })
      const updater = await import('./autoUpdater')
      await expect(updater.downloadAndInstallUpdate(release.version)).rejects.toThrow(
        mismatch === 'checksum' ? '校验失败' : '大小与发布清单不一致'
      )
      expect(await readFile(target, 'utf8')).toBe('existing download')
      expect(await readdir(directory)).toEqual(['Navio.zip'])
      expect(mocks.showInFolder).not.toHaveBeenCalled()
    }
  )
})
