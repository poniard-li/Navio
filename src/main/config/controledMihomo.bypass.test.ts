import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getControledMihomoConfig, patchControledMihomoConfig } from './controledMihomo'

const mocks = vi.hoisted(() => ({
  storedMode: 'rule',
  policy: { enabled: true, presets: [], processes: [], domains: ['example.com'] },
  generate: vi.fn(),
  reload: vi.fn(),
  patch: vi.fn(),
  write: vi.fn(),
  appPatch: vi.fn(),
  dnsState: { controlDns: true, controlDnsBeforePause: undefined } as {
    controlDns: boolean
    controlDnsBeforePause: boolean | undefined
  }
}))
vi.mock('fs', () => ({ existsSync: () => true }))
vi.mock('fs/promises', () => ({ readFile: async () => `mode: ${mocks.storedMode}\n` }))
vi.mock('../utils/dirs', () => ({ controledMihomoConfigPath: () => 'memory-mihomo.yaml' }))
vi.mock('../utils/template', () => ({ defaultControledMihomoConfig: { mode: 'rule' } }))
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }))
vi.mock('../utils/safeFile', () => ({
  atomicWriteFile: mocks.write,
  WriteQueue: class {
    run<T>(task: () => Promise<T>): Promise<T> {
      return task()
    }
  }
}))
vi.mock('./app', () => ({
  getAppConfig: async () => ({
    operationMode: 'standard',
    dexBypass: mocks.policy,
    ...mocks.dnsState
  }),
  patchAppConfig: async (patch: Partial<typeof mocks.dnsState>) => {
    mocks.appPatch(patch)
    Object.assign(mocks.dnsState, patch)
  }
}))
vi.mock('../core/factory', () => ({ generateProfile: mocks.generate }))
vi.mock('../core/mihomoApi', () => ({
  mihomoHotReloadConfig: mocks.reload,
  patchMihomoConfig: mocks.patch,
  startMihomoLogs: vi.fn()
}))
vi.mock('../resolve/gistApi', () => ({ scheduleRuntimeConfigUpload: vi.fn() }))

describe('global bypass mode transitions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.reload.mockReset().mockResolvedValue(undefined)
    mocks.generate.mockResolvedValue({})
    mocks.patch.mockResolvedValue(undefined)
    mocks.write.mockResolvedValue(undefined)
    mocks.storedMode = 'rule'
    mocks.policy = { enabled: true, presets: [], processes: [], domains: ['example.com'] }
    mocks.dnsState = { controlDns: true, controlDnsBeforePause: undefined }
    await getControledMihomoConfig(true)
  })

  it('persists user global intent and reloads rules rather than patching only the mode', async () => {
    await patchControledMihomoConfig({ mode: 'global' })
    expect((await getControledMihomoConfig()).mode).toBe('global')
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'global' }))
    expect(mocks.write).toHaveBeenCalledWith(
      'memory-mihomo.yaml',
      expect.stringContaining('mode: global'),
      { encoding: 'utf8' }
    )
    expect(mocks.reload).toHaveBeenCalledTimes(1)
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it.each(['rule', 'direct'] as const)(
    'reloads the original rules when leaving global exceptions for %s',
    async (mode) => {
      mocks.storedMode = 'global'
      await getControledMihomoConfig(true)
      await patchControledMihomoConfig({ mode })
      expect((await getControledMihomoConfig()).mode).toBe(mode)
      expect(mocks.reload).toHaveBeenCalledTimes(1)
    }
  )

  it('uses the ordinary mode patch if exceptions are disabled', async () => {
    mocks.policy.enabled = false
    await patchControledMihomoConfig({ mode: 'global' })
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(mocks.patch).toHaveBeenCalledWith({ mode: 'global' })
  })

  it('rolls back persistent intent and core if a full rule reload fails', async () => {
    mocks.reload.mockRejectedValueOnce(new Error('invalid runtime'))
    await expect(patchControledMihomoConfig({ mode: 'global' })).rejects.toThrow('invalid runtime')
    expect((await getControledMihomoConfig()).mode).toBe('rule')
    expect(mocks.write).toHaveBeenLastCalledWith(
      'memory-mihomo.yaml',
      expect.stringContaining('mode: rule'),
      { encoding: 'utf8' }
    )
    expect(mocks.reload).toHaveBeenCalledTimes(2)
  })

  it('restores paused DNS ownership before reloading a failed direct-to-global transition', async () => {
    mocks.storedMode = 'direct'
    mocks.dnsState = { controlDns: false, controlDnsBeforePause: true }
    await getControledMihomoConfig(true)
    mocks.reload
      .mockImplementationOnce(async () => {
        expect(mocks.dnsState).toEqual({ controlDns: true, controlDnsBeforePause: undefined })
        throw new Error('global reload failed')
      })
      .mockImplementationOnce(async () => {
        expect(mocks.dnsState).toEqual({ controlDns: false, controlDnsBeforePause: true })
      })

    await expect(patchControledMihomoConfig({ mode: 'global' })).rejects.toThrow(
      'global reload failed'
    )
    expect((await getControledMihomoConfig()).mode).toBe('direct')
    expect(mocks.appPatch).toHaveBeenLastCalledWith({
      controlDns: false,
      controlDnsBeforePause: true
    })
    expect(mocks.reload).toHaveBeenCalledTimes(2)
  })
})
