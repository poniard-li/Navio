import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupAppLifecycle } from './lifecycle'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  restore: vi.fn(),
  syncRestore: vi.fn(),
  exit: vi.fn(),
  stopCore: vi.fn(),
  cleanupWatcher: vi.fn(),
  closeTraffic: vi.fn(),
  save: vi.fn(),
  show: vi.fn(),
  error: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    on: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
    exit: mocks.exit
  },
  powerMonitor: { on: vi.fn() },
  dialog: { showErrorBox: mocks.error }
}))
vi.mock('./core/manager', () => ({
  stopCoreForExit: mocks.stopCore,
  cleanupCoreWatcher: mocks.cleanupWatcher
}))
vi.mock('./core/admin', () => ({ primeAdminPrivilegesCache: vi.fn() }))
vi.mock('./sys/sysproxy', () => ({
  restoreSysProxyForExit: mocks.restore,
  disableSysProxySync: mocks.syncRestore
}))
vi.mock('./traffic/recorder', () => ({ closeTrafficUsage: mocks.closeTraffic }))
vi.mock('./utils/dirs', () => ({ exePath: vi.fn() }))
vi.mock('./window', () => ({ saveMainWindowState: mocks.save, showMainWindow: mocks.show }))
function beforeQuit(event: { preventDefault: () => void }): unknown {
  const handler = mocks.handlers.get('before-quit')
  if (!handler) throw new Error('before-quit handler was not registered')
  return handler(event)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.restore.mockReset().mockResolvedValue(undefined)
  mocks.stopCore.mockResolvedValue(undefined)
  mocks.closeTraffic.mockResolvedValue(undefined)
  setupAppLifecycle()
})

describe('exit cleanup', () => {
  it('restores ownership before stopping the core and exiting', async () => {
    const event = { preventDefault: vi.fn() }
    await beforeQuit(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.restore).toHaveBeenCalledOnce()
    expect(mocks.stopCore).toHaveBeenCalledOnce()
    expect(mocks.restore.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stopCore.mock.invocationCallOrder[0]
    )
    expect(mocks.exit).toHaveBeenCalledOnce()
  })

  it('retains the window and core after restore failure, then permits retry', async () => {
    mocks.restore.mockRejectedValueOnce(new Error('permission denied'))
    await beforeQuit({ preventDefault: vi.fn() })
    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.stopCore).not.toHaveBeenCalled()
    expect(mocks.cleanupWatcher).not.toHaveBeenCalled()
    expect(mocks.show).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('恢复失败'),
      expect.stringContaining('permission denied')
    )
    await beforeQuit({ preventDefault: vi.fn() })
    expect(mocks.restore).toHaveBeenCalledTimes(2)
    expect(mocks.exit).toHaveBeenCalledOnce()
  })

  it('shares an in-flight cleanup across repeated quit requests', async () => {
    let finish!: () => void
    mocks.restore.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const first = beforeQuit({ preventDefault: vi.fn() })
    const second = beforeQuit({ preventDefault: vi.fn() })
    expect(mocks.restore).toHaveBeenCalledOnce()
    expect(mocks.exit).not.toHaveBeenCalled()
    finish()
    await Promise.all([first, second])
    expect(mocks.exit).toHaveBeenCalledOnce()
  })
})
