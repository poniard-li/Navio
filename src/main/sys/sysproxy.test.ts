import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  directory: '',
  online: true,
  state: { internet: {}, connections: {} } as {
    internet: Record<string, unknown>
    connections: Record<string, unknown>
  },
  startPac: vi.fn(),
  stopPac: vi.fn(),
  restore: vi.fn(),
  read: vi.fn(),
  manual: vi.fn(),
  auto: vi.fn()
}))
vi.mock('electron', () => ({ net: { isOnline: () => mocks.online } }))
vi.mock('sysproxy-rs', () => ({
  triggerManualProxy: mocks.manual,
  triggerAutoProxy: mocks.auto,
  getSystemProxy: vi.fn(),
  getAutoProxy: vi.fn(),
  setSystemProxy: vi.fn(),
  setAutoProxy: vi.fn()
}))
vi.mock('./windowsProxy', () => ({
  readWindowsProxyState: mocks.read,
  restoreWindowsProxyState: mocks.restore
}))
vi.mock('../utils/dirs', () => ({
  dataDir: () => mocks.directory,
  resourcesFilesDir: () => mocks.directory
}))
vi.mock('../utils/logger', () => ({
  proxyLogger: { error: vi.fn().mockResolvedValue(undefined), info: vi.fn(), warn: vi.fn() }
}))
vi.mock('../config', () => ({
  getAppConfig: async () => ({ sysProxy: { enable: true, mode: 'manual' } }),
  getControledMihomoConfig: async () => ({ 'mixed-port': 17890 })
}))
vi.mock('../resolve/server', () => ({
  startPacServer: mocks.startPac,
  stopPacServer: mocks.stopPac,
  pacPort: 10000
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-sysproxy-test-'))
  mocks.online = true
  mocks.state = {
    internet: {
      manual: { enabled: true, host: 'other-client', port: 7890, bypass: 'original' },
      pac: 'https://example.invalid/pac'
    },
    connections: {}
  }
  mocks.read.mockImplementation(() => structuredClone(mocks.state))
  mocks.restore.mockImplementation((state) => {
    mocks.state = structuredClone(state)
  })
  mocks.manual.mockImplementation((enabled, host, port, bypass) => {
    mocks.state.internet.manual = { enabled, host, port, bypass }
  })
  mocks.auto.mockImplementation((enabled, url) => {
    mocks.state.internet.pac = enabled ? url : null
  })
  mocks.startPac.mockReset().mockResolvedValue(undefined)
  mocks.stopPac.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  fs.rmSync(mocks.directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('system proxy integration', () => {
  it('publishes success only after the OS takeover has finished', async () => {
    const { triggerSysProxy } = await import('./sysproxy')
    const { getCoreRuntimeState } = await import('../core/runtime-state')
    let finish!: () => void
    mocks.startPac.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const pending = triggerSysProxy(true)
    await vi.waitFor(() => expect(mocks.startPac).toHaveBeenCalledOnce())
    expect(getCoreRuntimeState().sysProxy).toBe(false)
    finish()
    await pending
    expect(getCoreRuntimeState().sysProxy).toBe(true)
    mocks.stopPac.mockRejectedValueOnce(new Error('PAC cleanup failed'))
    await expect(triggerSysProxy(false)).rejects.toThrow('PAC cleanup failed')
    expect(getCoreRuntimeState().sysProxy).toBe(false)
  })

  it('does not retain a successful status after a failed takeover and rollback', async () => {
    const { triggerSysProxy } = await import('./sysproxy')
    const { getCoreRuntimeState } = await import('../core/runtime-state')
    await triggerSysProxy(true)
    mocks.startPac.mockRejectedValueOnce(new Error('takeover failed'))
    await expect(triggerSysProxy(true)).rejects.toThrow('takeover failed')
    expect(getCoreRuntimeState().sysProxy).toBeNull()
    await triggerSysProxy(false)
    expect(getCoreRuntimeState().sysProxy).toBe(false)
  })

  it('publishes the final disabled state after a rapid on and off request', async () => {
    const { triggerSysProxy } = await import('./sysproxy')
    const { getCoreRuntimeState } = await import('../core/runtime-state')
    await Promise.all([triggerSysProxy(true), triggerSysProxy(false)])
    expect(getCoreRuntimeState().sysProxy).toBe(false)
    expect(mocks.manual).not.toHaveBeenCalled()
  })

  it('leaves another client untouched on initial disabled startup and exit', async () => {
    const { triggerSysProxy, restoreSysProxyForExit } = await import('./sysproxy')
    await triggerSysProxy(false)
    await restoreSysProxyForExit()
    expect(mocks.manual).not.toHaveBeenCalled()
    expect(mocks.auto).not.toHaveBeenCalled()
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('restores original settings while offline', async () => {
    const original = structuredClone(mocks.state)
    const { triggerSysProxy } = await import('./sysproxy')
    await triggerSysProxy(true)
    mocks.online = false
    await triggerSysProxy(false)
    expect(mocks.state).toEqual(original)
  })

  it('waits for a pending takeover before restoring on exit', async () => {
    const original = structuredClone(mocks.state)
    const { triggerSysProxy, restoreSysProxyForExit } = await import('./sysproxy')
    let finish!: () => void
    mocks.startPac.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const enabling = triggerSysProxy(true)
    await vi.waitFor(() => expect(mocks.startPac).toHaveBeenCalledOnce())
    const exiting = restoreSysProxyForExit()
    expect(mocks.restore).not.toHaveBeenCalled()
    finish()
    await Promise.all([enabling, exiting])
    expect(mocks.state).toEqual(original)
    await expect(triggerSysProxy(true)).rejects.toThrow('for exit')
  })

  it('permits restore retry after an exit failure', async () => {
    const original = structuredClone(mocks.state)
    const { triggerSysProxy, restoreSysProxyForExit } = await import('./sysproxy')
    await triggerSysProxy(true)
    mocks.restore.mockImplementationOnce(() => {
      throw new Error('restore denied')
    })
    await expect(restoreSysProxyForExit()).rejects.toThrow('restore denied')
    await triggerSysProxy(false)
    expect(mocks.state).toEqual(original)
  })
})
