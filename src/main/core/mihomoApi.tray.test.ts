import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginCoreRuntimeStart,
  getCoreRuntimeState,
  setCoreRuntimeStatus,
  stopCoreRuntimeState
} from './runtime-state'
import {
  refreshMihomoTrayState,
  reportMihomoTunStopped,
  startMihomoTraffic,
  stopMihomoTraffic
} from './mihomoApi'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  traffic: vi.fn(),
  socket: null as null | { onmessage: ((event: { data: string }) => void) | null }
}))
vi.mock('axios', () => ({
  default: {
    create: () => ({ get: mocks.get, interceptors: { response: { use: vi.fn() } } })
  }
}))
vi.mock('electron', () => ({ app: { isReady: () => true } }))
vi.mock('ws', () => ({
  default: class {
    static OPEN = 1
    static CONNECTING = 0
    readyState = 1
    onmessage = null
    close = vi.fn()
    removeAllListeners = vi.fn()
    constructor() {
      mocks.socket = this
    }
  }
}))
vi.mock('../resolve/tray', () => ({ updateTrayTraffic: mocks.traffic }))
vi.mock('../window', () => ({ mainWindow: null }))
vi.mock('../resolve/floatingWindow', () => ({ floatingWindow: null }))
vi.mock('../config', () => ({}))
vi.mock('../traffic/recorder', () => ({ recordTrafficUsage: vi.fn() }))
vi.mock('../traffic/navio-live', () => ({
  recordNavioTrafficRate: vi.fn(),
  recordNavioTrafficTotals: vi.fn()
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../utils/dirs', () => ({ mihomoWorkConfigPath: vi.fn() }))
vi.mock('./factory', () => ({}))
vi.mock('./dnsOverrideGuard', () => ({}))
vi.mock('./manager', () => ({
  getMihomoIpcPath: () => 'test-pipe',
  hasCoreProcess: () => true,
  restartCore: vi.fn()
}))

beforeEach(() => {
  mocks.get.mockReset()
  mocks.traffic.mockClear()
  stopCoreRuntimeState()
  const generation = beginCoreRuntimeStart()
  setCoreRuntimeStatus('running', generation)
})

describe('controller observations for the tray', () => {
  it('keeps the newest TUN result when rapid changes finish out of order', async () => {
    let finishOld!: (value: unknown) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        })
    )
    const oldRequest = refreshMihomoTrayState()
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
    mocks.get.mockResolvedValueOnce({ tun: { enable: false } })
    await refreshMihomoTrayState()
    finishOld({ tun: { enable: true } })
    await oldRequest
    expect(getCoreRuntimeState().tun).toBe(false)
  })

  it('ignores a controller response belonging to an exited process', async () => {
    let finish!: (value: unknown) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const request = refreshMihomoTrayState()
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
    stopCoreRuntimeState()
    finish({ tun: { enable: true } })
    await request
    expect(getCoreRuntimeState()).toMatchObject({ status: 'stopped', tun: false })
  })

  it('does not turn controller read failures into a core process failure', async () => {
    mocks.get.mockRejectedValueOnce(new Error('controller timeout'))
    await refreshMihomoTrayState()
    expect(getCoreRuntimeState().status).toBe('running')
  })

  it('does not let a late read undo a confirmed TUN listening failure', async () => {
    let finish!: (value: unknown) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const request = refreshMihomoTrayState()
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
    reportMihomoTunStopped(getCoreRuntimeState().generation)
    finish({ tun: { enable: true } })
    await request
    expect(getCoreRuntimeState()).toMatchObject({ status: 'running', tun: false })
  })

  it('routes traffic through the status tooltip and ignores retired traffic streams', async () => {
    await startMihomoTraffic()
    const receive = mocks.socket?.onmessage
    if (!receive) throw new Error('Traffic listener was not registered')
    receive({ data: JSON.stringify({ up: 12, down: 34 }) })
    expect(mocks.traffic).toHaveBeenCalledWith(12, 34)
    stopMihomoTraffic()
    receive({ data: JSON.stringify({ up: 90, down: 90 }) })
    expect(mocks.traffic).toHaveBeenCalledOnce()
  })
})
