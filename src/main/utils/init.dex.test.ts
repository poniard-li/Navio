import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  kill: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rename: vi.fn(),
  write: vi.fn()
}))
vi.mock('child_process', async () => {
  const { promisify } = await import('util')
  const exec = vi.fn()
  const execFile = vi.fn()
  Object.defineProperty(exec, promisify.custom, { value: mocks.exec })
  Object.defineProperty(execFile, promisify.custom, { value: mocks.exec })
  return { exec, execFile }
})
vi.mock('fs/promises', () => ({
  cp: mocks.cp,
  rm: mocks.rm,
  mkdir: mocks.mkdir,
  readdir: mocks.readdir,
  stat: mocks.stat,
  rename: mocks.rename
}))
vi.mock('fs', () => ({
  existsSync: (filename: string) =>
    filename.replace(/\\/g, '/').startsWith('C:/DEXResources/files/')
}))
vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN', setAsDefaultProtocolClient: vi.fn() },
  dialog: { showErrorBox: vi.fn() }
}))
vi.mock('../resolve/server', () => ({
  startPacServer: vi.fn(),
  startSubStoreBackendServer: vi.fn(),
  startSubStoreFrontendServer: vi.fn(),
  subStorePort: 10001,
  subStoreFrontendPort: 10002
}))
vi.mock('../sys/sysproxy', () => ({ triggerSysProxy: vi.fn() }))
vi.mock('../sys/ssid', () => ({ startSSIDCheck: vi.fn() }))
vi.mock('../sys/resume', () => ({ initResumeRecovery: vi.fn() }))
vi.mock('../config', () => ({
  getAppConfig: async () => ({
    useSubStore: false,
    siderOrder: [],
    appTheme: 'system',
    operationMode: 'standard',
    sysProxy: { enable: false }
  }),
  getControledMihomoConfig: async () => ({}),
  patchAppConfig: vi.fn(),
  patchControledMihomoConfig: vi.fn()
}))
vi.mock('../../shared/i18n', () => ({ default: { t: (key: string) => key }, resources: {} }))
vi.mock('../../shared/simple-config', () => ({ defaultSimpleDraft: () => ({}) }))
vi.mock('./yaml', () => ({ stringify: JSON.stringify }))
vi.mock('./safeFile', () => ({ atomicWriteFile: mocks.write }))
vi.mock('./logger', () => ({ initLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./dirs', () => {
  const dirs: Record<string, () => string> = { resourcesFilesDir: () => 'C:/DEXResources/files' }
  for (const name of [
    'dataDir',
    'logDir',
    'mihomoTestDir',
    'mihomoWorkDir',
    'overrideDir',
    'profilesDir',
    'rulesDir',
    'subStoreDir',
    'themesDir'
  ]) {
    dirs[name] = () => `C:/DEXData/${name}`
  }
  for (const name of [
    'appConfigPath',
    'controledMihomoConfigPath',
    'overrideConfigPath',
    'profileConfigPath',
    'profilePath',
    'simpleConfigPath'
  ]) {
    dirs[name] = () => `C:/DEXData/${name}.yaml`
  }
  return dirs
})

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('DEX_TEST_MODE', '')
  vi.stubGlobal(
    'process',
    Object.create(process, { platform: { value: 'win32' }, kill: { value: mocks.kill } })
  )
  // If global process enumeration is accidentally reintroduced, there are
  // other clients to discover; the test must fail instead of seeing an empty list.
  mocks.exec.mockResolvedValue({
    stdout: '"mihomo.exe","321"\r\n"mihomo-alpha.exe","322"\r\n"mihomo-smart.exe","323"',
    stderr: ''
  })
  mocks.cp.mockReset().mockResolvedValue(undefined)
  mocks.rm.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.readdir.mockResolvedValue([])
  mocks.write.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('DEX runtime files initialization', () => {
  it('copies runtime resources without enumerating or terminating other running clients', async () => {
    const { ensureRuntimeFiles } = await import('./init')
    await ensureRuntimeFiles()
    expect(mocks.cp).toHaveBeenCalledWith(
      path.join('C:/DEXResources/files', 'country.mmdb'),
      path.join('C:/DEXData/mihomoWorkDir', 'country.mmdb'),
      { recursive: true, force: true }
    )
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.kill).not.toHaveBeenCalled()
  })

  it('shares concurrent initialization without any process cleanup', async () => {
    const { ensureRuntimeFiles } = await import('./init')
    await Promise.all([ensureRuntimeFiles(), ensureRuntimeFiles()])
    const copies = mocks.cp.mock.calls.length
    expect(copies).toBeGreaterThan(0)
    await ensureRuntimeFiles()
    expect(mocks.cp).toHaveBeenCalledTimes(copies)
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.kill).not.toHaveBeenCalled()
  })

  it('does not kill processes to recover from a locked critical resource', async () => {
    mocks.cp.mockRejectedValue(Object.assign(new Error('resource locked'), { code: 'EACCES' }))
    const { ensureRuntimeFiles } = await import('./init')
    await expect(ensureRuntimeFiles()).rejects.toThrow('Failed to copy critical file')
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.kill).not.toHaveBeenCalled()
  })
})
