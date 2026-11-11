import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDexBypass } from './dex-bypass'

const mocks = vi.hoisted(() => ({
  config: { dexBypass: undefined } as { dexBypass: unknown },
  reload: vi.fn(),
  notify: vi.fn(),
  tray: vi.fn(),
  writes: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.notify } }] },
  ipcMain: { emit: mocks.tray }
}))
vi.mock('../config/app', () => ({
  getAppConfig: async () => mocks.config,
  patchAppConfig: async (patch: { dexBypass: unknown }) => {
    mocks.writes(patch)
    mocks.config.dexBypass = patch.dexBypass
  }
}))
vi.mock('../core/mihomoApi', () => ({ mihomoHotReloadConfig: mocks.reload }))

const policy = { enabled: true, presets: ['wechat'], processes: [], domains: [] }

describe('save direct exceptions transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reload.mockReset().mockResolvedValue(undefined)
    mocks.config.dexBypass = undefined
  })
  it('reloads the rule table before publishing a successful save', async () => {
    expect(await saveDexBypass(policy)).toEqual(policy)
    expect(mocks.reload).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith('rulesUpdated')
    expect(mocks.tray).toHaveBeenCalledWith('updateTrayMenu')
  })
  it('rejects rule injection before touching persisted settings or the core', async () => {
    await expect(
      saveDexBypass({ ...policy, domains: ['safe.test,DIRECT\nMATCH,REJECT'] })
    ).rejects.toThrow()
    expect(mocks.writes).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })
  it('restores previous policy and runtime if apply fails', async () => {
    const previous = { ...policy, presets: ['douyin'] }
    mocks.config.dexBypass = previous
    mocks.reload.mockRejectedValueOnce(new Error('core rejected config'))
    await expect(saveDexBypass(policy)).rejects.toThrow('已恢复原设置')
    expect(mocks.config.dexBypass).toEqual(previous)
    expect(mocks.reload).toHaveBeenCalledTimes(2)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('surfaces failed recovery instead of claiming successful application', async () => {
    mocks.reload.mockRejectedValue(new Error('offline'))
    await expect(saveDexBypass(policy)).rejects.toThrow('恢复内核也未成功')
    expect(mocks.config.dexBypass).toEqual({
      enabled: false,
      presets: [],
      processes: [],
      domains: []
    })
  })
})
