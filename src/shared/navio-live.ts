import type { TrafficUsageOverview } from './trafficUsage'

export interface NavioTrafficPoint {
  timestamp: number
  upload: number
  download: number
}

export interface NavioTrafficState {
  timestamp: number
  coreRunning: boolean
  accessEnabled: boolean
  streamOnline: boolean
  up: number
  down: number
  session: {
    startedAt: number | null
    endedAt: number | null
    elapsedMs: number
    upload: number
    download: number
    points: NavioTrafficPoint[]
  }
  today: {
    startTime: number
    updatedAt: number | null
    available: boolean
    upload: number
    download: number
    points: NavioTrafficPoint[]
  }
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function navioDailyTraffic(
  value: TrafficUsageOverview,
  requestedAt: number
): NavioTrafficState['today'] {
  const day = startOfLocalDay(requestedAt)
  const nonnegative = (amount: number): number =>
    Number.isFinite(amount) && amount > 0 ? amount : 0
  let upload = 0
  let download = 0
  const points: NavioTrafficPoint[] = [{ timestamp: day, upload: 0, download: 0 }]
  for (const point of [...value.trend]
    .filter((point) => point.timestamp >= day && point.timestamp <= requestedAt)
    .sort((a, b) => a.timestamp - b.timestamp)) {
    upload += nonnegative(point.upload)
    download += nonnegative(point.download)
    points.push({ timestamp: Math.min(requestedAt, point.timestamp + 300000), upload, download })
  }
  upload = nonnegative(value.totals.upload)
  download = nonnegative(value.totals.download)
  points.push({ timestamp: requestedAt, upload, download })
  return { startTime: day, updatedAt: requestedAt, available: true, upload, download, points }
}
