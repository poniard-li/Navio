import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginCoreRuntimeStart,
  setAppliedSystemProxy,
  setAppliedTunState,
  setCoreRuntimeStatus,
  stopCoreRuntimeState
} from '../core/runtime-state'
import {
  closeTrayIcon,
  createTray,
  updateTrayIcon,
  updateTrayIconImmediate,
  updateTrayTraffic
} from './tray'

const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  tooltip: vi.fn(),
  getApp: vi.fn(),
  getCore: vi.fn()
}))
vi.mock('electron', () => ({
  app: {},
  dialog: {},
  ipcMain: { emit: vi.fn() },
  Menu: {},
  nativeImage: {},
  shell: {},
  systemPreferences: {},
  Tray: class {
    setImage = mocks.image
    setToolTip = mocks.tooltip
    setIgnoreDoubleClickEvents = vi.fn()
    addListener = vi.fn()
    destroy = vi.fn()
  }
}))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('../config', () => ({
  getAppConfig: mocks.getApp,
  getControledMihomoConfig: mocks.getCore
}))
vi.mock('../config/app', () => ({ subscribeAppConfig: () => vi.fn() }))
vi.mock('../core/mihomoApi', () => ({}))
vi.mock('../window', () => ({ mainWindow: null }))
vi.mock('../utils/dirs', () => ({}))
vi.mock('../sys/sysproxy', () => ({}))
vi.mock('../core/manager', () => ({}))
vi.mock('../utils/logger', () => ({ trayLogger: {} }))
vi.mock('../utils/clipboard', () => ({}))
vi.mock('./floatingWindow', () => ({ floatingWindow: null }))
vi.mock('./navio-tools', () => ({}))

beforeEach(async () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  stopCoreRuntimeState()
  setAppliedSystemProxy(false)
  mocks.getApp.mockReset().mockResolvedValue({ sysProxy: { enable: false } })
  mocks.getCore.mockReset().mockResolvedValue({ mode: 'rule', tun: { enable: false } })
  mocks.image.mockClear()
  mocks.tooltip.mockClear()
  await createTray()
})

afterEach(async () => {
  await closeTrayIcon()
  vi.unstubAllGlobals()
})

describe('tray rendering', () => {
  it('does not display an optimistic switch before the OS operation succeeds', async () => {
    updateTrayIconImmediate(true, true)
    await updateTrayIcon()
    expect(mocks.image.mock.lastCall?.[0]).toContain('tray_off.ico')
    expect(mocks.tooltip.mock.lastCall?.[0]).toContain('tray.systemProxy: tray.tooltip.disabled')
  })

  it('preserves product, mode and core state while traffic changes', async () => {
    const generation = beginCoreRuntimeStart()
    setCoreRuntimeStatus('running', generation)
    setAppliedSystemProxy(true)
    setAppliedTunState(true, generation)
    await updateTrayIcon()
    updateTrayTraffic(1024, 2048)
    const tooltip = mocks.tooltip.mock.lastCall?.[0]
    expect(tooltip).toContain('Navio')
    expect(tooltip).toContain('tray.tooltip.mode: tray.ruleMode')
    expect(tooltip).toContain('tray.systemProxy: tray.tooltip.enabled')
    expect(tooltip).toContain('tray.tun: tray.tooltip.enabled')
    expect(tooltip).toContain('tray.tooltip.core: tray.tooltip.core.running')
    expect(tooltip).toContain('↑ 1.00 KB/s  ↓ 2.00 KB/s')
    expect(mocks.image.mock.lastCall?.[0]).toContain('tray_tun.ico')
    setCoreRuntimeStatus('error', generation)
    await updateTrayIcon()
    updateTrayTraffic(100, 200)
    expect(mocks.image.mock.lastCall?.[0]).toContain('tray_error.ico')
    expect(mocks.tooltip.mock.lastCall?.[0]).toContain('tray.tooltip.core.error')
    expect(mocks.tooltip.mock.lastCall?.[0]).not.toContain('KB/s')
  })

  it('does not allow a slower config read to undo the newest appearance', async () => {
    let finishOld!: (value: unknown) => void
    mocks.getApp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        })
    )
    const oldRefresh = updateTrayIcon()
    mocks.getApp.mockResolvedValue({ sysProxy: { enable: false }, disableTrayIconColor: true })
    setAppliedSystemProxy(true)
    await updateTrayIcon()
    expect(mocks.image.mock.lastCall?.[0]).toContain('tray_off.ico')
    const calls = mocks.image.mock.calls.length
    finishOld({ sysProxy: { enable: true }, disableTrayIconColor: false })
    await oldRefresh
    expect(mocks.image).toHaveBeenCalledTimes(calls)
    expect(mocks.tooltip.mock.lastCall?.[0]).toContain('tray.systemProxy: tray.tooltip.enabled')
  })

  it('clearly labels an unconfirmed proxy write without reporting a core error', async () => {
    setAppliedSystemProxy(null)
    await updateTrayIcon()
    expect(mocks.image.mock.lastCall?.[0]).toContain('tray_off.ico')
    expect(mocks.tooltip.mock.lastCall?.[0]).toContain('tray.systemProxy: tray.tooltip.unknown')
  })
})
