import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ battery: vi.fn(), send: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    app: new Emitter(),
    powerMonitor: Object.assign(new Emitter(), { isOnBatteryPower: mocks.battery })
  }
})
import { app, powerMonitor, type BrowserWindow } from 'electron'
import { getMotionEnvironment, startMotionEnvironment } from './motion-environment'

describe('window motion environment', () => {
  afterEach(() => {
    ;(app as unknown as EventEmitter).emit('before-quit')
    vi.useRealTimers()
    vi.clearAllMocks()
  })
  it('tracks hidden windows, power changes and resume, then removes listeners', () => {
    vi.useFakeTimers()
    let visible = true
    mocks.battery.mockReturnValue(false)
    const window = {
      isDestroyed: () => false,
      isVisible: () => visible,
      isMinimized: () => false,
      webContents: { send: mocks.send }
    } as unknown as BrowserWindow
    startMotionEnvironment(() => window)
    expect(getMotionEnvironment()).toMatchObject({ windowVisible: true, onBattery: false })
    visible = false
    mocks.battery.mockReturnValue(true)
    vi.advanceTimersByTime(2000)
    expect(getMotionEnvironment()).toMatchObject({ windowVisible: false, onBattery: true })
    powerMonitor.emit('suspend')
    expect(getMotionEnvironment().suspended).toBe(true)
    powerMonitor.emit('resume')
    expect(getMotionEnvironment().suspended).toBe(false)
    powerMonitor.emit('speed-limit-change', { limit: 60 })
    expect(getMotionEnvironment().speedLimit).toBe(60)
    ;(app as unknown as EventEmitter).emit('before-quit')
    expect(powerMonitor.listenerCount('resume')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
