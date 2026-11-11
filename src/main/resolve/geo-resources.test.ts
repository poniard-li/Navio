import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  config: vi.fn(),
  lock: vi.fn(),
  stoppedCore: vi.fn(),
  dirs: { work: '', test: '' }
}))
vi.mock('../config', () => ({ getControledMihomoConfig: mocks.config }))
vi.mock('../utils/dirs', () => ({
  mihomoWorkDir: () => mocks.dirs.work,
  mihomoTestDir: () => mocks.dirs.test
}))
vi.mock('../core/check-profile', () => ({ withProfileCheckLock: mocks.lock }))
vi.mock('../core/manager', () => ({ withStoppedCoreResources: mocks.stoppedCore }))
vi.mock('../utils/template', () => ({
  defaultControledMihomoConfig: {
    'geox-url': Object.fromEntries(
      ['mmdb', 'geoip', 'asn', 'geosite'].map((key) => [key, `https://example.test/${key}`])
    )
  }
}))
vi.mock('./release-download', () => ({ fetchReleaseAsset: mocks.fetch }))

const completeMmdb = Buffer.concat([
  Buffer.alloc(2048, 1),
  Buffer.from('\xab\xcd\xefMaxMind.com', 'latin1'),
  Buffer.from('binary_format_major_version database_type node_count record_size')
])
let temporaryDir: string
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'navio-geo-download-'))
  mocks.dirs.work = path.join(temporaryDir, 'work')
  mocks.dirs.test = path.join(temporaryDir, 'test')
  await Promise.all(Object.values(mocks.dirs).map((dir) => mkdir(dir)))
  mocks.config.mockResolvedValue({})
  mocks.lock.mockImplementation(async (_dir, task) => task())
  mocks.stoppedCore.mockImplementation(async (task) => task())
})
afterEach(async () => {
  await rm(temporaryDir, { recursive: true, force: true })
})

describe('explicit Geo resource download', () => {
  it('does not download or replace data while the core is running', async () => {
    mocks.stoppedCore.mockRejectedValueOnce(new Error('内核正在运行'))
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('内核正在运行')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('retains files when the core starts during a download', async () => {
    mocks.fetch.mockImplementation(async () => new Response(completeMmdb))
    mocks.stoppedCore
      .mockImplementationOnce(async (task) => task())
      .mockRejectedValueOnce(new Error('内核正在运行'))
    const file = path.join(mocks.dirs.work, 'country.mmdb')
    await writeFile(file, completeMmdb)
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('内核正在运行')
    expect(await readFile(file)).toEqual(completeMmdb)
    expect(await readdir(mocks.dirs.test)).toEqual([])
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('reports absent or incomplete data without fetching or modifying files', async () => {
    await writeFile(path.join(mocks.dirs.work, 'country.mmdb'), Buffer.alloc(2048, 1))
    const { getGeoResourceStatus } = await import('./geo-resources')
    expect(await getGeoResourceStatus()).toEqual([
      'country.mmdb',
      'geoip.dat',
      'ASN.mmdb',
      'geosite.dat'
    ])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(await readdir(mocks.dirs.work)).toEqual(['country.mmdb'])
  })
  it('does not replace files when the source returns an error page', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } })
    )
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('不是有效数据库')
    expect(await readdir(mocks.dirs.work)).toEqual([])
  })
  it('rejects insecure configured URLs before making a request', async () => {
    mocks.config.mockResolvedValue({ 'geox-url': { mmdb: 'http://example.test/data' } })
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('HTTPS')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects oversized declared content before writing', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(2048), {
        headers: { 'content-length': String(129 * 1024 * 1024) }
      })
    )
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('不是有效数据库')
    expect(await readdir(mocks.dirs.work)).toEqual([])
  })
  it('rejects a content-length mismatch and retains the previous database', async () => {
    const file = path.join(mocks.dirs.work, 'country.mmdb')
    await writeFile(file, completeMmdb)
    mocks.fetch.mockResolvedValue(
      new Response(completeMmdb, {
        headers: { 'content-length': String(completeMmdb.length + 10) }
      })
    )
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('下载不完整')
    expect(await readFile(file)).toEqual(completeMmdb)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('rejects missing MMDB metadata despite receiving more than 1KB', async () => {
    mocks.fetch.mockResolvedValue(new Response(Buffer.alloc(3000, 1)))
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('内容无效或下载不完整')
    expect(await readdir(mocks.dirs.work)).toEqual([])
  })
  it('validates all four resources before any replacement, including ASN metadata', async () => {
    const file = path.join(mocks.dirs.work, 'country.mmdb')
    await writeFile(file, completeMmdb)
    const replacement = Buffer.from(completeMmdb)
    replacement[0] = 2
    mocks.fetch.mockImplementation(
      async (url: URL) =>
        new Response(url.pathname === '/asn' ? Buffer.alloc(2048, 1) : replacement)
    )
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('ASN.mmdb')
    expect(await readFile(file)).toEqual(completeMmdb)
    expect(await readdir(mocks.dirs.work)).toEqual(['country.mmdb'])
    expect(await readdir(mocks.dirs.test)).toEqual([])
  })
  it('shares a download, then commits validation data only while holding its directory lock', async () => {
    mocks.fetch.mockImplementation(async () => {
      expect(await readdir(mocks.dirs.work)).toEqual([])
      return new Response(completeMmdb, {
        headers: { 'content-length': '17', 'content-encoding': 'gzip' }
      })
    })
    mocks.lock.mockImplementation(async (dir: string, task: () => Promise<void>) => {
      expect(dir).toBe(mocks.dirs.test)
      expect(await readdir(dir)).toEqual([])
      expect(await readdir(mocks.dirs.work)).toEqual([])
      await task()
      expect((await readdir(dir)).length).toBe(4)
      expect((await readdir(mocks.dirs.work)).length).toBe(4)
    })
    const { downloadGeoResources } = await import('./geo-resources')
    await Promise.all([downloadGeoResources(), downloadGeoResources()])
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(mocks.lock).toHaveBeenCalledTimes(1)
    for (const dir of Object.values(mocks.dirs))
      expect(await readFile(path.join(dir, 'country.mmdb'))).toEqual(completeMmdb)
  })
})
