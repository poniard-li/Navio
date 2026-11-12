import { describe, expect, it, vi } from 'vitest'
vi.mock('./database', () => ({ queryTrafficUsageOverview: vi.fn() }))
vi.mock('./recorder', () => ({ flushTrafficUsage: vi.fn() }))
vi.mock('electron', () => ({ powerMonitor: { on: vi.fn(), removeListener: vi.fn() } }))
import { startOfLocalDay } from '../../shared/navio-live'
import { NavioTrafficTracker } from './navio-live'

const start = new Date(2026, 10, 13, 10, 0, 0).getTime()
function connected(): NavioTrafficTracker {
  const tracker = new NavioTrafficTracker(start)
  tracker.setCore(true, start)
  tracker.setAccess(true, start)
  return tracker
}

describe('Navio live traffic lifecycle', () => {
  it('counts only observed absolute-counter differences, not pre-existing traffic', () => {
    const tracker = connected()
    tracker.totals({ uploadTotal: 1000, downloadTotal: 4000 }, start)
    tracker.rate({ up: 200, down: 300 }, start + 1000)
    tracker.totals({ uploadTotal: 1200, downloadTotal: 4300 }, start + 1000)
    expect(tracker.snapshot(start + 1000)).toMatchObject({
      up: 200,
      down: 300,
      streamOnline: true,
      session: { upload: 200, download: 300, elapsedMs: 1000 }
    })
    expect(tracker.snapshot(start + 5000)).toMatchObject({
      up: 0,
      down: 0,
      streamOnline: false,
      session: { upload: 200, download: 300 }
    })
  })
  it('freezes a disconnected session and starts a fresh baseline on reconnect', () => {
    const tracker = connected()
    tracker.totals({ uploadTotal: 1, downloadTotal: 1 }, start)
    tracker.totals({ uploadTotal: 21, downloadTotal: 31 }, start + 1000)
    tracker.setAccess(false, start + 2000)
    tracker.totals({ uploadTotal: 400, downloadTotal: 500 }, start + 3000)
    expect(tracker.snapshot(start + 7000).session).toMatchObject({
      endedAt: start + 2000,
      elapsedMs: 2000,
      upload: 20,
      download: 30
    })
    tracker.setAccess(true, start + 8000)
    tracker.totals({ uploadTotal: 900, downloadTotal: 1000 }, start + 8000)
    tracker.totals({ uploadTotal: 910, downloadTotal: 1020 }, start + 9000)
    expect(tracker.snapshot(start + 9000).session).toMatchObject({
      startedAt: start + 8000,
      endedAt: null,
      elapsedMs: 1000,
      upload: 10,
      download: 20
    })
  })
  it('handles core counter reset without adding a negative delta', () => {
    const tracker = connected()
    tracker.totals({ uploadTotal: 100, downloadTotal: 100 }, start)
    tracker.totals({ uploadTotal: 10, downloadTotal: 10 }, start + 1000)
    tracker.totals({ uploadTotal: 20, downloadTotal: 30 }, start + 2000)
    expect(tracker.snapshot(start + 2000).session).toMatchObject({ upload: 10, download: 20 })
  })
  it('ends a session on core loss even while OS proxy remains enabled', () => {
    const tracker = connected()
    tracker.rate({ up: 2, down: 3 }, start + 1000)
    tracker.setCore(false, start + 2000)
    expect(tracker.snapshot(start + 3000)).toMatchObject({
      accessEnabled: true,
      coreRunning: false,
      up: 0,
      down: 0,
      session: { elapsedMs: 2000, endedAt: start + 2000 }
    })
    tracker.setCore(true, start + 4000)
    expect(tracker.snapshot(start + 5000)).toMatchObject({
      streamOnline: false,
      session: { startedAt: start + 4000, elapsedMs: 1000 }
    })
  })
  it('builds cumulative daily points from persisted totals and rolls at local midnight', () => {
    const tracker = connected()
    const day = startOfLocalDay(start)
    tracker.history(
      {
        rankings: [],
        trend: [
          { timestamp: day, upload: 10, download: 20 },
          { timestamp: day + 300000, upload: 20, download: 40 }
        ],
        totals: { upload: 30, download: 60, total: 90, count: 2 }
      },
      start,
      start
    )
    const today = tracker.snapshot(start).today
    expect(today.available).toBe(true)
    expect(today.points.map((point) => point.download)).toEqual([0, 20, 60, 60])
    expect(today.points.at(-1)?.timestamp).toBe(start)
    const tomorrow = new Date(2026, 10, 14, 0, 0, 0).getTime()
    expect(tracker.snapshot(tomorrow).today).toMatchObject({
      startTime: tomorrow,
      available: false,
      upload: 0,
      download: 0
    })
  })
  it('clears cumulative samples without ending the active connection', () => {
    const tracker = connected()
    tracker.totals({ uploadTotal: 10, downloadTotal: 10 }, start)
    tracker.totals({ uploadTotal: 20, downloadTotal: 30 }, start + 1000)
    tracker.reset(start + 2000)
    tracker.totals({ uploadTotal: 30, downloadTotal: 50 }, start + 3000)
    expect(tracker.snapshot(start + 3000).session).toMatchObject({
      startedAt: start,
      elapsedMs: 3000,
      upload: 0,
      download: 0
    })
    tracker.totals({ uploadTotal: 40, downloadTotal: 70 }, start + 4000)
    expect(tracker.snapshot(start + 4000).session).toMatchObject({ upload: 10, download: 20 })
  })
  it('bounds sample memory while keeping the origin, final point and totals', () => {
    const tracker = connected()
    for (let index = 0; index < 2000; index++)
      tracker.totals({ uploadTotal: index, downloadTotal: index * 2 }, start + index * 1000)
    const session = tracker.snapshot(start + 2000000).session
    expect(session.points.length).toBeLessThanOrEqual(360)
    expect(session.points[0].timestamp).toBe(start)
    expect(session.points.at(-1)?.download).toBe(3998)
  })
})
