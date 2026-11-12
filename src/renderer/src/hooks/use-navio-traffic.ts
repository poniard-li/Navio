import { useSyncExternalStore } from 'react'
import { getNavioTrafficState } from '@renderer/utils/ipc'
import { getTrafficOverview } from '@renderer/utils/dataUsage'
import {
  navioDailyTraffic,
  startOfLocalDay,
  type NavioTrafficState
} from '../../../shared/navio-live'

const now = Date.now()
let state: NavioTrafficState = {
  timestamp: 0,
  coreRunning: false,
  accessEnabled: false,
  streamOnline: false,
  up: 0,
  down: 0,
  session: { startedAt: null, endedAt: null, elapsedMs: 0, upload: 0, download: 0, points: [] },
  today: {
    startTime: startOfLocalDay(now),
    updatedAt: null,
    available: false,
    upload: 0,
    download: 0,
    points: []
  }
}
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | undefined
let historyTimer: ReturnType<typeof setInterval> | undefined
let historyLoading = false
let historyGeneration = 0
let localToday: NavioTrafficState['today'] | undefined

function clearLocalHistory(): void {
  historyGeneration += 1
  const timestamp = Date.now()
  localToday = {
    startTime: startOfLocalDay(timestamp),
    updatedAt: timestamp,
    available: true,
    upload: 0,
    download: 0,
    points: []
  }
  state = { ...state, today: localToday }
  listeners.forEach((listener) => listener())
}

async function refreshLegacyHistory(): Promise<void> {
  if (!__LEGACY_BUILD__ || historyLoading || document.hidden) return
  historyLoading = true
  const generation = historyGeneration
  const requestedAt = Date.now()
  try {
    const overview = await getTrafficOverview(
      'process',
      startOfLocalDay(requestedAt),
      requestedAt,
      300000
    )
    if (
      generation !== historyGeneration ||
      startOfLocalDay(requestedAt) !== startOfLocalDay(Date.now())
    )
      return
    localToday = navioDailyTraffic(overview, requestedAt)
    state = { ...state, today: localToday }
    listeners.forEach((listener) => listener())
  } catch {
    // Keep the last completed local database read and retry on the next refresh.
  } finally {
    historyLoading = false
  }
}

function accept(next: NavioTrafficState): void {
  if (!next || typeof next.timestamp !== 'number' || next.timestamp < state.timestamp) return
  state =
    __LEGACY_BUILD__ && localToday?.startTime === startOfLocalDay(next.timestamp)
      ? { ...next, today: localToday }
      : next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribe) {
    unsubscribe = window.electron.ipcRenderer.on('navioTrafficState', (_event, ...args) => {
      accept(args[0] as NavioTrafficState)
    })
    void getNavioTrafficState()
      .then(accept)
      .catch(() => {})
    if (__LEGACY_BUILD__) {
      void refreshLegacyHistory()
      historyTimer = setInterval(() => void refreshLegacyHistory(), 5000)
      document.addEventListener('visibilitychange', refreshLegacyHistory)
      window.addEventListener('navio-traffic-cleared', clearLocalHistory)
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      unsubscribe?.()
      unsubscribe = undefined
      if (historyTimer) clearInterval(historyTimer)
      historyTimer = undefined
      document.removeEventListener('visibilitychange', refreshLegacyHistory)
      window.removeEventListener('navio-traffic-cleared', clearLocalHistory)
      historyGeneration += 1
      localToday = undefined
      if (__LEGACY_BUILD__)
        state = {
          ...state,
          today: { ...state.today, available: false, upload: 0, download: 0, points: [] }
        }
    }
  }
}

export function useNavioTraffic(): NavioTrafficState {
  return useSyncExternalStore(subscribe, () => state)
}
