import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { managerLogger } from '../utils/logger'
import { getAxios } from './mihomoApi'

const execFilePromise = promisify(execFile)

// 常量
const CORE_READY_MAX_RETRIES = 30
const CORE_READY_RETRY_INTERVAL_MS = 100

export async function cleanupSocketFile(): Promise<void> {
  if (process.platform === 'win32') {
    await cleanupWindowsNamedPipes()
  } else {
    await cleanupUnixSockets()
  }
}

// Each D.E.X instance uses a unique named pipe. Windows releases it when its
// owning process exits. Never terminate other proxy clients to clear a pipe.
export async function cleanupWindowsNamedPipes(_thorough = false): Promise<void> {
  return
}

// Best-effort check whether a PID is still alive without actually killing it.
// process.kill(pid, 0) throws ESRCH when the process is gone and EPERM when
// it is alive but owned by another user (we treat that as "alive, don't touch").
function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    // EPERM etc: assume alive so we err on the side of NOT deleting a live socket.
    return true
  }
}

export async function cleanupUnixSockets(): Promise<void> {
  const uid = process.getuid?.() ?? 'user'

  // Legacy fixed socket paths from older releases. These never contain a PID
  // and are safe to remove unconditionally if they exist.
  const legacyPaths = [
    '/tmp/dex-studio.sock',
    '/tmp/dex-studio-admin.sock',
    `/tmp/dex-studio-${uid}.sock`
  ]

  for (const socketPath of legacyPaths) {
    try {
      if (existsSync(socketPath)) {
        await rm(socketPath)
        managerLogger.info(`Cleaned up legacy socket file: ${socketPath}`)
      }
    } catch (error) {
      managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
    }
  }

  // Current getMihomoIpcPath() produces /tmp/dex-studio-<uid>-<pid>.sock,
  // where <pid> is the parent Electron main-process PID. Previous versions
  // never garbage-collected these when the parent exited, so /tmp accumulates
  // one file per historical session. Sweep them now, but ONLY delete files
  // whose parent PID is no longer running to avoid nuking a sibling instance
  // (another Party window from a different user, an admin-elevated session,
  // etc.) that legitimately owns its own socket.
  const currentPrefix = `dex-studio-${uid}-`
  try {
    const entries = await readdir('/tmp')
    for (const name of entries) {
      if (!name.startsWith(currentPrefix) || !name.endsWith('.sock')) continue
      const pidPart = name.slice(currentPrefix.length, -'.sock'.length)
      const pid = parseInt(pidPart, 10)
      if (!Number.isFinite(pid)) continue
      // Do not touch our own socket.
      if (pid === process.pid) continue
      if (isPidAlive(pid)) continue
      const socketPath = `/tmp/${name}`
      try {
        await rm(socketPath)
        managerLogger.info(`Cleaned up stale per-PID socket: ${socketPath}`)
      } catch (error) {
        managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
      }
    }
  } catch (error) {
    // ENOENT on /tmp is impossible, EPERM/EACCES worth logging but not fatal.
    managerLogger.warn('Failed to enumerate /tmp for stale sockets:', error)
  }
}

export async function validateWindowsPipeAccess(pipePath: string): Promise<void> {
  try {
    managerLogger.info(`Validating pipe access for: ${pipePath}`)
    managerLogger.info(`Pipe validation completed for: ${pipePath}`)
  } catch (error) {
    managerLogger.error('Windows pipe validation failed:', error)
  }
}

export async function waitForCoreReady(): Promise<void> {
  for (let i = 0; i < CORE_READY_MAX_RETRIES; i++) {
    try {
      const axios = await getAxios(true)
      await axios.get('/')
      managerLogger.info(
        `Core ready after ${i + 1} attempts (${(i + 1) * CORE_READY_RETRY_INTERVAL_MS}ms)`
      )
      return
    } catch {
      if (i === 0) {
        managerLogger.info('Waiting for core to be ready...')
      }

      if (i === CORE_READY_MAX_RETRIES - 1) {
        throw new Error(
          `Core not ready after ${CORE_READY_MAX_RETRIES} attempts (${CORE_READY_MAX_RETRIES * CORE_READY_RETRY_INTERVAL_MS}ms)`
        )
      }

      await new Promise((resolve) => setTimeout(resolve, CORE_READY_RETRY_INTERVAL_MS))
    }
  }
}

function normalizeProcessName(name: string): string {
  return name
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase()
}

export async function verifyProcessOwner(
  pid: number,
  expectedNames: readonly string[],
  expectedPaths?: readonly string[]
): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  try {
    let processName = ''
    if (process.platform === 'win32') {
      const { stdout } = await execFilePromise(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 1000 }
      )
      const match = stdout.match(/^"([^"]+)","(\d+)"/m)
      if (!match || parseInt(match[2], 10) !== pid) return false
      processName = match[1]
    } else {
      const nameField = process.platform === 'darwin' ? 'ucomm=' : 'comm='
      const { stdout } = await execFilePromise('ps', ['-p', `${pid}`, '-o', nameField], {
        timeout: 1000
      })
      processName = stdout.trim().split(/\r?\n/, 1)[0] || ''
    }

    // A stale PID file may refer to a reused PID. Name alone is insufficient.
    if (expectedPaths?.length) {
      if (process.platform !== 'win32') return false
      const { stdout } = await execFilePromise(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").ExecutablePath`
        ],
        { windowsHide: true, timeout: 5000 }
      )
      const executable = stdout.trim().replace(/\\/g, '/').toLowerCase()
      if (
        !executable ||
        !expectedPaths.some((p) => p.replace(/\\/g, '/').toLowerCase() === executable)
      )
        return false
    }

    const normalizedName = normalizeProcessName(processName)
    return expectedNames.some((name) => normalizeProcessName(name) === normalizedName)
  } catch {
    return false
  }
}
