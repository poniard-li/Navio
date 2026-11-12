import { powerMonitor } from 'electron'
import type { NavioTrafficState } from '../../shared/navio-live'
import { navioDailyTraffic, startOfLocalDay } from '../../shared/navio-live'
import type { TrafficUsageOverview } from '../../shared/trafficUsage'
import { getCoreRuntimeState, subscribeCoreRuntimeState } from '../core/runtime-state'
import { queryTrafficUsageOverview } from './database'
import { flushTrafficUsage } from './recorder'

const RATE_STALE_MS = 4000
const HISTORY_INTERVAL_MS = 5000
const HISTORY_BUCKET_MS = 5 * 60 * 1000
const MAX_SESSION_POINTS = 360

const nonnegative = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

export class NavioTrafficTracker {
  private coreRunning = false
  private accessEnabled = false
  private rateAt: number | null = null
  private up = 0
  private down = 0
  private previousTotals: { upload: number; download: number } | null = null
  private session: NavioTrafficState['session'] = {
    startedAt: null,
    endedAt: null,
    elapsedMs: 0,
    upload: 0,
    download: 0,
    points: []
  }
  private today: NavioTrafficState['today']

  constructor(now = Date.now()) {
    this.today = this.emptyToday(now)
  }

  private emptyToday(now: number): NavioTrafficState['today'] {
    return {
      startTime: startOfLocalDay(now),
      updatedAt: null,
      available: false,
      upload: 0,
      download: 0,
      points: []
    }
  }

  private updateSession(wasConnected: boolean, now: number): void {
    const connected = this.coreRunning && this.accessEnabled
    if (wasConnected === connected) return
    this.previousTotals = null
    this.up = 0
    this.down = 0
    this.rateAt = null
    if (connected) {
      this.session = {
        startedAt: now,
        endedAt: null,
        elapsedMs: 0,
        upload: 0,
        download: 0,
        points: [{ timestamp: now, upload: 0, download: 0 }]
      }
    } else if (this.session.startedAt !== null && this.session.endedAt === null) {
      this.session.endedAt = now
      this.session.elapsedMs = Math.max(0, now - this.session.startedAt)
    }
  }

  setCore(running: boolean, now = Date.now()): void {
    const wasConnected = this.coreRunning && this.accessEnabled
    this.coreRunning = running
    if (!running) this.previousTotals = null
    this.updateSession(wasConnected, now)
  }

  setAccess(enabled: boolean, now = Date.now()): void {
    const wasConnected = this.coreRunning && this.accessEnabled
    this.accessEnabled = enabled
    this.updateSession(wasConnected, now)
  }

  rate(value: { up: number; down: number }, now = Date.now()): void {
    this.up = nonnegative(value.up)
    this.down = nonnegative(value.down)
    this.rateAt = now
  }

  totals(value: { uploadTotal: number; downloadTotal: number }, now = Date.now()): void {
    const current = {
      upload: nonnegative(value.uploadTotal),
      download: nonnegative(value.downloadTotal)
    }
    if (!this.coreRunning || !this.accessEnabled) {
      this.previousTotals = null
      return
    }
    const previous = this.previousTotals
    this.previousTotals = current
    if (!previous) return
    if (current.upload < previous.upload || current.download < previous.download) {
      // A new core counter generation cannot be subtracted from the previous one.
      return
    }
    this.session.upload += current.upload - previous.upload
    this.session.download += current.download - previous.download
    const point = {
      timestamp: now,
      upload: this.session.upload,
      download: this.session.download
    }
    const last = this.session.points.at(-1)
    if (last?.timestamp === now) this.session.points[this.session.points.length - 1] = point
    else this.session.points.push(point)
    if (this.session.points.length > MAX_SESSION_POINTS) {
      const past = this.session.points.slice(0, 240).filter((_, index) => index % 2 === 0)
      this.session.points = [...past, ...this.session.points.slice(240)]
    }
  }

  history(value: TrafficUsageOverview, requestedAt: number, now = Date.now()): void {
    const day = startOfLocalDay(now)
    if (startOfLocalDay(requestedAt) !== day) return
    this.today = navioDailyTraffic(value, requestedAt)
  }

  reset(now = Date.now()): void {
    this.today = { ...this.emptyToday(now), available: true, updatedAt: now }
    this.session.upload = 0
    this.session.download = 0
    this.session.points = [{ timestamp: now, upload: 0, download: 0 }]
    this.previousTotals = null
  }

  snapshot(now = Date.now()): NavioTrafficState {
    if (this.today.startTime !== startOfLocalDay(now)) this.today = this.emptyToday(now)
    const connected = this.coreRunning && this.accessEnabled
    const streamOnline =
      connected &&
      this.rateAt !== null &&
      now - this.rateAt >= 0 &&
      now - this.rateAt < RATE_STALE_MS
    const elapsedMs =
      connected && this.session.startedAt !== null
        ? Math.max(0, now - this.session.startedAt)
        : this.session.elapsedMs
    return {
      timestamp: now,
      coreRunning: this.coreRunning,
      accessEnabled: this.accessEnabled,
      streamOnline,
      up: streamOnline ? this.up : 0,
      down: streamOnline ? this.down : 0,
      session: {
        ...this.session,
        elapsedMs,
        points: this.session.points.map((point) => ({ ...point }))
      },
      today: { ...this.today, points: this.today.points.map((point) => ({ ...point })) }
    }
  }
}

const tracker = new NavioTrafficTracker()
const listeners = new Set<(state: NavioTrafficState) => void>()
let timer: NodeJS.Timeout | null = null
let unsubscribeRuntime: (() => void) | null = null
let lastHistoryAt = 0
let historyLoading = false
let historyGeneration = 0
let suspended = false
let removePowerListeners: (() => void) | null = null

export function getNavioTrafficState(): NavioTrafficState {
  return tracker.snapshot()
}

function publish(): void {
  const state = getNavioTrafficState()
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
      // A closed window must not interrupt traffic collection.
    }
  }
}

export function subscribeNavioTraffic(listener: (state: NavioTrafficState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setNavioTrafficAccess(enabled: boolean, now = Date.now()): void {
  tracker.setAccess(enabled, now)
  publish()
}

export function setNavioTrafficCore(running: boolean, now = Date.now()): void {
  tracker.setCore(running, now)
  publish()
}

export function recordNavioTrafficRate(
  value: { up: number; down: number },
  now = Date.now()
): void {
  tracker.rate(value, now)
  publish()
}

export function recordNavioTrafficTotals(
  value: { uploadTotal: number; downloadTotal: number },
  now = Date.now()
): void {
  tracker.totals(value, now)
}

async function refreshHistory(): Promise<void> {
  if (historyLoading || __LEGACY_BUILD__) return
  historyLoading = true
  const generation = historyGeneration
  const requestedAt = Date.now()
  lastHistoryAt = requestedAt
  try {
    await flushTrafficUsage()
    const value = await queryTrafficUsageOverview(
      'process',
      startOfLocalDay(requestedAt),
      requestedAt,
      HISTORY_BUCKET_MS
    )
    if (generation === historyGeneration) tracker.history(value, requestedAt)
  } catch {
    // Keep the last confirmed database snapshot while the next refresh retries.
  } finally {
    historyLoading = false
    publish()
  }
}

export function resetNavioTrafficUsage(now = Date.now()): void {
  historyGeneration += 1
  lastHistoryAt = 0
  tracker.reset(now)
  publish()
}

export function startNavioTrafficTelemetry(): void {
  if (timer) return
  const syncRuntime = (): void => {
    const runtime = getCoreRuntimeState()
    tracker.setCore(!suspended && runtime.status === 'running')
    tracker.setAccess(runtime.sysProxy === true || runtime.tun)
    publish()
  }
  unsubscribeRuntime = subscribeCoreRuntimeState(syncRuntime)
  const onSuspend = (): void => {
    suspended = true
    syncRuntime()
  }
  const onResume = (): void => {
    suspended = false
    syncRuntime()
    void refreshHistory()
  }
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)
  removePowerListeners = () => {
    powerMonitor.removeListener('suspend', onSuspend)
    powerMonitor.removeListener('resume', onResume)
  }
  syncRuntime()
  void refreshHistory()
  timer = setInterval(() => {
    publish()
    if (Date.now() - lastHistoryAt >= HISTORY_INTERVAL_MS) void refreshHistory()
  }, 1000)
  timer.unref()
}

export function stopNavioTrafficTelemetry(): void {
  if (timer) clearInterval(timer)
  timer = null
  unsubscribeRuntime?.()
  unsubscribeRuntime = null
  removePowerListeners?.()
  removePowerListeners = null
  suspended = false
  historyGeneration += 1
  tracker.setCore(false)
}
