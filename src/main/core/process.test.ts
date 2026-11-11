import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupWindowsNamedPipes,
  cleanupSocketFile,
  cleanupUnixSockets,
  verifyProcessOwner
} from './process'

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  kill: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  exists: vi.fn(),
  getAxios: vi.fn()
}))
vi.mock('child_process', async () => {
  const { promisify } = await import('util')
  const execFile = vi.fn()
  Object.defineProperty(execFile, promisify.custom, { value: mocks.exec })
  return { execFile }
})
vi.mock('fs/promises', () => ({ readdir: mocks.readdir, rm: mocks.rm }))
vi.mock('fs', () => ({ existsSync: mocks.exists }))
vi.mock('../utils/logger', () => ({
  managerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./mihomoApi', () => ({ getAxios: mocks.getAxios }))

function usePlatform(platform: string): void {
  vi.stubGlobal(
    'process',
    Object.create(process, {
      platform: { value: platform },
      pid: { value: 9999 },
      getuid: { value: () => 1000 },
      kill: { value: mocks.kill }
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  usePlatform('win32')
  mocks.kill.mockReset().mockReturnValue(true)
  mocks.exists.mockReturnValue(false)
  mocks.readdir.mockResolvedValue([])
  mocks.rm.mockResolvedValue(undefined)
  mocks.exec.mockReset().mockImplementation(async (file: string) => ({
    stdout:
      file === 'tasklist'
        ? '"mihomo.exe","42","Console","1","100 K"'
        : 'C:\\DEX\\resources\\sidecar\\mihomo.exe\r\n'
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('DEX process ownership', () => {
  it('does not enumerate or kill any process when clearing Windows pipes', async () => {
    await cleanupWindowsNamedPipes()
    await cleanupWindowsNamedPipes(true)
    await cleanupSocketFile()
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.kill).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })

  it('accepts only the named PID at the expected executable path', async () => {
    expect(await verifyProcessOwner(42, ['mihomo'], ['c:/dex/resources/sidecar/MIHOMO.EXE'])).toBe(
      true
    )
    expect(mocks.kill).toHaveBeenCalledExactlyOnceWith(42, 0)
    expect(mocks.exec).toHaveBeenNthCalledWith(
      1,
      'tasklist',
      ['/FI', 'PID eq 42', '/FO', 'CSV', '/NH'],
      expect.any(Object)
    )
  })

  it('rejects a same-named core belonging to another client', async () => {
    expect(await verifyProcessOwner(42, ['mihomo'], ['C:/OtherClient/mihomo.exe'])).toBe(false)
    expect(mocks.kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true)
  })

  it('rejects PID reuse by a different executable name', async () => {
    mocks.exec.mockImplementation(async (file: string) => ({
      stdout: file === 'tasklist' ? '"another.exe","42"' : 'C:\\DEX\\resources\\sidecar\\mihomo.exe'
    }))
    expect(await verifyProcessOwner(42, ['mihomo'], ['C:/DEX/resources/sidecar/mihomo.exe'])).toBe(
      false
    )
  })

  it('rejects a tasklist response for a different PID', async () => {
    mocks.exec.mockResolvedValue({ stdout: '"mihomo.exe","43"' })
    expect(await verifyProcessOwner(42, ['mihomo'], ['C:/DEX/resources/sidecar/mihomo.exe'])).toBe(
      false
    )
    expect(mocks.exec).toHaveBeenCalledOnce()
  })

  it.each(['', '   \r\n'])('rejects an unreadable executable path', async (stdout) => {
    mocks.exec.mockImplementation(async (file: string) => ({
      stdout: file === 'tasklist' ? '"mihomo.exe","42"' : stdout
    }))
    expect(await verifyProcessOwner(42, ['mihomo'], ['C:/DEX/resources/sidecar/mihomo.exe'])).toBe(
      false
    )
  })

  it('leaves an inaccessible elevated core untouched', async () => {
    mocks.exec.mockImplementation(async (file: string) => {
      if (file === 'powershell.exe') throw new Error('Access denied')
      return { stdout: '"mihomo.exe","42"' }
    })
    expect(await verifyProcessOwner(42, ['mihomo'], ['C:/DEX/resources/sidecar/mihomo.exe'])).toBe(
      false
    )
    expect(mocks.kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true)
  })

  it('skips an already exited process without launching tasklist', async () => {
    mocks.kill.mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    expect(await verifyProcessOwner(42, ['mihomo'], ['C:/DEX/resources/sidecar/mihomo.exe'])).toBe(
      false
    )
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it('does not assume executable path ownership on unsupported platforms', async () => {
    usePlatform('linux')
    mocks.exec.mockResolvedValue({ stdout: 'mihomo' })
    expect(await verifyProcessOwner(42, ['mihomo'], ['/opt/dex/mihomo'])).toBe(false)
  })
})

describe('Unix socket cleanup scope', () => {
  it('only removes stale DEX sockets for the current user', async () => {
    usePlatform('linux')
    mocks.readdir.mockResolvedValue([
      'mihomo-party.sock',
      'mihomo-party-1000-222.sock',
      'dex-studio-1000-222.sock',
      'dex-studio-1000-777.sock',
      'dex-studio-1000-9999.sock',
      'dex-studio-1001-222.sock',
      'unrelated.sock'
    ])
    mocks.kill.mockImplementation((pid: number) => {
      if (pid === 222) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      return true
    })
    await cleanupUnixSockets()
    expect(mocks.rm).toHaveBeenCalledExactlyOnceWith('/tmp/dex-studio-1000-222.sock')
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true)
  })

  it('preserves sockets when the owning PID cannot be inspected', async () => {
    usePlatform('linux')
    mocks.readdir.mockResolvedValue(['dex-studio-1000-777.sock'])
    mocks.kill.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    await cleanupUnixSockets()
    expect(mocks.rm).not.toHaveBeenCalled()
  })
})
