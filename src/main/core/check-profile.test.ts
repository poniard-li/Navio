import { execFile, type ChildProcess, type ExecFileException } from 'child_process'
import { EventEmitter } from 'events'
import { join, sep } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PROFILE_CHECK_TIMEOUT_MS,
  runProfileCheck,
  withProfileCheckLock
} from './check-profile'

vi.mock('child_process', () => ({ execFile: vi.fn() }))

interface FakeProcess {
  child: EventEmitter & { kill: ReturnType<typeof vi.fn> }
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
}

const processes: FakeProcess[] = []
const workDir = join(process.cwd(), 'test-profile-check')
const request = { corePath: 'core', configPath: 'config.yaml', workDir }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function finish(index: number, error: ExecFileException | null = null): void {
  processes[index].callback(error, 'core stdout', 'core stderr')
  processes[index].child.emit('close', error ? 1 : 0, null)
}

beforeEach(() => {
  processes.length = 0
  vi.mocked(execFile).mockReset()
  vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
    processes.push({ child, callback })
    return child as unknown as ChildProcess
  }) as typeof execFile)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('profile check directory lock', () => {
  it('serializes preparation, process closure, and success commits for normalized directories', async () => {
    const preparing = deferred()
    const committing = deferred()
    const order: string[] = []
    const first = runProfileCheck({
      ...request,
      prepare: async () => {
        order.push('prepare first')
        await preparing.promise
      },
      afterSuccess: async () => {
        order.push('commit first')
        await committing.promise
      }
    })
    const second = runProfileCheck({
      ...request,
      workDir: `${process.platform === 'win32' ? workDir.toUpperCase() : workDir}${sep}nested${sep}..${sep}`,
      prepare: async () => {
        order.push('prepare second')
      }
    })
    const resourceCommit = withProfileCheckLock(workDir, async () => {
      order.push('resource commit')
    })
    await flush()
    expect(order).toEqual(['prepare first'])
    expect(processes).toHaveLength(0)
    preparing.resolve()
    await flush()
    expect(processes).toHaveLength(1)
    finish(0)
    await flush()
    expect(order).toEqual(['prepare first', 'commit first'])
    expect(processes).toHaveLength(1)
    committing.resolve()
    await first
    await flush()
    expect(order).toEqual(['prepare first', 'commit first', 'prepare second'])
    expect(processes).toHaveLength(2)
    finish(1)
    await Promise.all([second, resourceCommit])
    expect(order.at(-1)).toBe('resource commit')
  })

  it('allows independent directories to check concurrently', async () => {
    const first = runProfileCheck(request)
    const other = runProfileCheck({ ...request, workDir: `${workDir}-other` })
    await flush()
    expect(processes).toHaveLength(2)
    finish(1)
    await other
    finish(0)
    await first
  })

  it('cancels a waiting check without letting its successor overtake the current holder', async () => {
    const first = runProfileCheck(request)
    const controller = new AbortController()
    const prepare = vi.fn(async () => {})
    const waiting = runProfileCheck({ ...request, signal: controller.signal, prepare })
    const rejected = expect(waiting).rejects.toThrow('cancel waiting')
    const successor = runProfileCheck(request)
    controller.abort(new Error('cancel waiting'))
    await rejected
    await flush()
    expect(processes).toHaveLength(1)
    expect(prepare).not.toHaveBeenCalled()
    finish(0)
    await first
    await flush()
    expect(processes).toHaveLength(2)
    finish(1)
    await successor
  })

  it('preserves core errors and output but waits for close before starting the next check', async () => {
    const failure = Object.assign(new Error('bad config'), { code: 1 })
    const first = runProfileCheck(request)
    const rejected = expect(first).rejects.toMatchObject({
      message: 'bad config',
      code: 1,
      stdout: 'rule error',
      stderr: 'core stderr'
    })
    const successor = runProfileCheck(request)
    await flush()
    processes[0].callback(failure, 'rule error', 'core stderr')
    await flush()
    expect(processes).toHaveLength(1)
    processes[0].child.emit('close', 1, null)
    await rejected
    await flush()
    expect(processes).toHaveLength(2)
    finish(1)
    await successor
  })

  it('kills on cancellation and holds the lock until the child closes', async () => {
    const controller = new AbortController()
    const afterSuccess = vi.fn(async () => {})
    const first = runProfileCheck({ ...request, signal: controller.signal, afterSuccess })
    const rejected = expect(first).rejects.toMatchObject({
      message: 'cancel running',
      stdout: 'core stdout',
      stderr: 'core stderr'
    })
    const successor = runProfileCheck(request)
    await flush()
    controller.abort(new Error('cancel running'))
    await flush()
    expect(processes[0].child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(processes).toHaveLength(1)
    finish(0)
    await rejected
    await flush()
    expect(afterSuccess).not.toHaveBeenCalled()
    expect(processes).toHaveLength(2)
    finish(1)
    await successor
  })

  it('applies the default hard timeout and never treats a timed-out close as success', async () => {
    vi.useFakeTimers()
    const afterSuccess = vi.fn(async () => {})
    const first = runProfileCheck({ ...request, afterSuccess })
    const rejected = expect(first).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
      stdout: 'core stdout'
    })
    await flush()
    await vi.advanceTimersByTimeAsync(DEFAULT_PROFILE_CHECK_TIMEOUT_MS)
    expect(processes[0].child.kill).toHaveBeenCalledWith('SIGKILL')
    const successor = runProfileCheck(request)
    await flush()
    expect(processes).toHaveLength(1)
    finish(0)
    await rejected
    await flush()
    expect(afterSuccess).not.toHaveBeenCalled()
    expect(processes).toHaveLength(2)
    finish(1)
    await successor
  })

  it('keeps in-flight preparation locked on timeout and does not start its child afterwards', async () => {
    vi.useFakeTimers()
    const preparing = deferred()
    const first = runProfileCheck({
      ...request,
      timeoutMs: 50,
      prepare: async () => preparing.promise
    })
    const rejected = expect(first).rejects.toMatchObject({ name: 'TimeoutError' })
    await flush()
    await vi.advanceTimersByTimeAsync(50)
    const successor = runProfileCheck(request)
    await flush()
    expect(processes).toHaveLength(0)
    preparing.resolve()
    await rejected
    await flush()
    expect(processes).toHaveLength(1)
    finish(0)
    await successor
  })
})
