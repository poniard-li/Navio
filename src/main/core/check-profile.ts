import { execFile, type ExecFileException } from 'child_process'
import { resolve } from 'path'
import { KeyedWriteQueue } from '../utils/safeFile'

export const DEFAULT_PROFILE_CHECK_TIMEOUT_MS = 120_000

const profileCheckLocks = new KeyedWriteQueue()

/** Also used by Geo resource commits; do not acquire this lock recursively. */
export function withProfileCheckLock<T>(
  workDir: string,
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const resolved = resolve(workDir)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  return profileCheckLocks.run(key, task, signal)
}

export interface ProfileCheckRequest {
  corePath: string
  configPath: string
  workDir: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Total budget, including time spent waiting for another check. */
  timeoutMs?: number
  prepare?: (signal: AbortSignal) => Promise<void>
  afterSuccess?: (signal: AbortSignal) => Promise<void>
}

function cancellationError(signal: AbortSignal): Error {
  const reason = signal.reason
  const error = new Error(reason instanceof Error ? reason.message : 'The operation was aborted', {
    cause: reason
  })
  error.name = reason instanceof Error ? reason.name : 'AbortError'
  return Object.assign(error, {
    code: reason instanceof Error && 'code' in reason ? reason.code : 'ABORT_ERR'
  })
}

function checkProcess(request: ProfileCheckRequest, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise<void>((resolveCheck, reject) => {
    let processError: ExecFileException | null = null
    let stdout = ''
    let stderr = ''
    const child = execFile(
      request.corePath,
      ['-t', '-f', request.configPath, '-d', request.workDir],
      { env: request.env, windowsHide: true, encoding: 'utf8' },
      (error, out, err) => {
        processError = error
        stdout = out
        stderr = err
      }
    )

    // execFile's AbortSignal rejects on `error`, before the process has closed its
    // Geo files. Kill ourselves, then retain the directory lock until `close`.
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.once('close', () => {
      signal.removeEventListener('abort', onAbort)
      // execFile installs its callback listener before ours, preserving its
      // collected output and native errors, including spawn/maxBuffer failures.
      const error = signal.aborted ? cancellationError(signal) : processError
      if (error) reject(Object.assign(error, { stdout, stderr }))
      else resolveCheck()
    })
    if (signal.aborted) onAbort()
  })
}

export async function runProfileCheck(request: ProfileCheckRequest): Promise<void> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_PROFILE_CHECK_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError('Profile check timeout must be a positive, finite timer duration')
  }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(request.signal?.reason)
  request.signal?.addEventListener('abort', onAbort, { once: true })
  if (request.signal?.aborted) onAbort()
  const timer = setTimeout(() => {
    const error = new Error(`Profile check timed out after ${timeoutMs} ms`)
    error.name = 'TimeoutError'
    controller.abort(Object.assign(error, { code: 'ETIMEDOUT' }))
  }, timeoutMs)
  timer.unref?.()

  try {
    await withProfileCheckLock(
      request.workDir,
      async () => {
        await request.prepare?.(controller.signal)
        controller.signal.throwIfAborted()
        await checkProcess(request, controller.signal)
        controller.signal.throwIfAborted()
        await request.afterSuccess?.(controller.signal)
        controller.signal.throwIfAborted()
      },
      controller.signal
    )
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }
}
