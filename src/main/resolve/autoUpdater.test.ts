import { createHash } from 'crypto'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  portable: vi.fn(),
  request: vi.fn(),
  fetch: vi.fn(),
  message: vi.fn(),
  runner: vi.fn(),
  stage: vi.fn(),
  temp: '',
  quit: vi.fn()
}))
vi.mock('../utils/dirs', () => ({
  isPortable: mocks.portable,
  exeDir: () => path.join(mocks.temp, 'Navio')
}))
vi.mock('./dex-account', () => ({
  dexAccountRequest: mocks.request,
  dexServerUrl: async () => 'https://navio.mydex.top'
}))
vi.mock('./release-download', () => ({ fetchReleaseAsset: mocks.fetch }))
vi.mock('./update-runner', async (original) => ({
  ...(await original<object>()),
  startUpdateRunner: mocks.runner
}))
vi.mock('./update-package', async (original) => ({
  ...(await original<object>()),
  stagePortableUpdate: mocks.stage
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.6.0-beta.5', getPath: () => mocks.temp, quit: mocks.quit },
  dialog: { showMessageBox: mocks.message },
  BrowserWindow: { getAllWindows: () => [] }
}))
const payload = 'verified archive'
const portable = {
  url: 'https://github.com/poniard-li/Navio/releases/download/v1.0.0-beta.6/Navio.zip',
  size: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex')
}
const installer = { ...portable, url: portable.url.replace('.zip', '.exe') }
const release = {
  version: '1.0.0-beta.6',
  notes: '更新',
  ...portable,
  artifacts: { portable, installer }
}
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.temp = await mkdtemp(path.join(tmpdir(), 'navio-update-test-'))
  mocks.portable.mockReturnValue(true)
  mocks.request.mockResolvedValue({ release })
  mocks.fetch.mockImplementation(async () => new Response(payload))
  mocks.message.mockResolvedValue({ response: 0 })
})
afterEach(async () => {
  await rm(mocks.temp, { recursive: true, force: true })
})
describe('in-app Windows updates', () => {
  it.each([
    ['1.0.0-beta.6', '0.6.0-beta.5', true],
    ['1.0.0', '1.0.0-beta.6', true],
    ['1.0.0-beta.7', '1.0.0-beta.6', true],
    ['1.0.0-beta.6', '1.0.0-beta.6', false],
    ['1.0.0-beta.6', '1.0.0', false]
  ])('compares candidate %s with installed %s', async (candidate, installed, expected) => {
    const { newerVersion } = await import('./autoUpdater')
    expect(newerVersion(candidate, installed)).toBe(expected)
  })

  it.each([true, false])(
    'downloads the matching package, verifies and waits for confirmation (portable=%s)',
    async (portableMode) => {
      mocks.portable.mockReturnValue(portableMode)
      await (await import('./autoUpdater')).downloadAndInstallUpdate(release.version)
      expect(mocks.fetch.mock.calls[0][0].href).toBe((portableMode ? portable : installer).url)
      expect(mocks.runner).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: portableMode ? 'portable' : 'installer',
          sha256: portable.sha256,
          version: '1.0.0-beta.6'
        }),
        expect.any(String)
      )
      expect(mocks.quit).toHaveBeenCalledOnce()
      expect(mocks.message).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Navio Release 1.0.0 · Public Beta 6 已下载并通过校验'
        })
      )
      expect(mocks.message.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.runner.mock.invocationCallOrder[0]
      )
    }
  )
  it('checks old installed manifests but never executes their portable ZIP', async () => {
    mocks.portable.mockReturnValue(false)
    mocks.request.mockResolvedValue({ release: { ...release, artifacts: undefined } })
    const api = await import('./autoUpdater')
    expect((await api.checkUpdate())?.version).toBe(release.version)
    await expect(api.downloadAndInstallUpdate(release.version)).rejects.toThrow('尚未提供安装版')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each(['checksum', 'size', 'format'])('rejects %s before exit or execution', async (kind) => {
    if (kind === 'format') mocks.stage.mockRejectedValue(new Error('无效的程序'))
    else
      mocks.request.mockResolvedValue({
        release: {
          ...release,
          artifacts: {
            portable: {
              ...portable,
              ...(kind === 'size' ? { size: 1 } : { sha256: '0'.repeat(64) })
            }
          }
        }
      })
    await expect(
      (await import('./autoUpdater')).downloadAndInstallUpdate(release.version)
    ).rejects.toThrow()
    expect(mocks.runner).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(await readdir(mocks.temp)).toEqual([])
  })
  it('does not exit or leave download files when installation is deferred', async () => {
    mocks.message.mockResolvedValue({ response: 1 })
    await (await import('./autoUpdater')).downloadAndInstallUpdate(release.version)
    expect(mocks.runner).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(await readdir(mocks.temp)).toEqual([])
  })
  it('does not quit if helper launch fails', async () => {
    mocks.runner.mockRejectedValue(new Error('helper unavailable'))
    await expect(
      (await import('./autoUpdater')).downloadAndInstallUpdate(release.version)
    ).rejects.toThrow('helper unavailable')
    expect(mocks.quit).not.toHaveBeenCalled()
  })
  it.each(['../../other', '0.6.0?download=evil', 'https://evil.example'])(
    'rejects invalid version %s',
    async (version) => {
      mocks.request.mockResolvedValue({ release: { ...release, version } })
      await expect(
        (await import('./autoUpdater')).downloadAndInstallUpdate(version)
      ).rejects.toThrow('版本号无效')
    }
  )
})
