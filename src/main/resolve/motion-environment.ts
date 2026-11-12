import { app, powerMonitor, type BrowserWindow } from 'electron'
import type { NavioMotionEnvironment } from '../../shared/navio-material'

let state: NavioMotionEnvironment = {
  onBattery: null,
  windowVisible: false,
  suspended: false,
  speedLimit: null
}
let stop: (() => void) | undefined

export function getMotionEnvironment(): NavioMotionEnvironment {
  return { ...state }
}

export function startMotionEnvironment(getWindow: () => BrowserWindow | null | undefined): void {
  stop?.()
  const refresh = (): void => {
    const window = getWindow()
    let onBattery: boolean | null = null
    try {
      const value = powerMonitor.isOnBatteryPower()
      onBattery = typeof value === 'boolean' ? value : null
    } catch {
      // Unavailable power status is not treated as a power-saving signal.
    }
    const next = {
      ...state,
      onBattery,
      windowVisible: Boolean(
        window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
      )
    }
    if (JSON.stringify(state) === JSON.stringify(next)) return
    state = next
    if (window && !window.isDestroyed())
      window.webContents.send('motionEnvironmentUpdated', getMotionEnvironment())
  }
  const update = (patch: Partial<NavioMotionEnvironment>): void => {
    state = { ...state, ...patch }
    refresh()
    const window = getWindow()
    if (window && !window.isDestroyed())
      window.webContents.send('motionEnvironmentUpdated', getMotionEnvironment())
  }
  const suspend = (): void => update({ suspended: true })
  const resume = (): void => update({ suspended: false })
  const speed = (details: { limit: number }): void => {
    update({
      speedLimit: Number.isFinite(details?.limit) ? Math.max(0, Math.min(100, details.limit)) : null
    })
  }
  powerMonitor.on('suspend', suspend)
  powerMonitor.on('resume', resume)
  powerMonitor.on('speed-limit-change', speed)
  // Polling also covers Windows runtimes that do not emit AC/battery events.
  const timer = setInterval(refresh, 2000)
  timer.unref()
  refresh()
  stop = (): void => {
    clearInterval(timer)
    powerMonitor.removeListener('suspend', suspend)
    powerMonitor.removeListener('resume', resume)
    powerMonitor.removeListener('speed-limit-change', speed)
    app.removeListener('before-quit', dispose)
    stop = undefined
  }
  const dispose = (): void => stop?.()
  app.once('before-quit', dispose)
}
