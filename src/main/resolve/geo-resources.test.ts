import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  write: vi.fn(),
  fetch: vi.fn(),
  config: vi.fn()
}))
vi.mock('fs', () => ({ existsSync: mocks.exists }))
vi.mock('fs/promises', () => ({ mkdir: vi.fn() }))
vi.mock('../config', () => ({ getControledMihomoConfig: mocks.config }))
vi.mock('../utils/dirs', () => ({ mihomoWorkDir: () => '/work', mihomoTestDir: () => '/test' }))
vi.mock('../utils/safeFile', () => ({ atomicWriteFile: mocks.write }))
vi.mock('../utils/template', () => ({
  defaultControledMihomoConfig: {
    'geox-url': Object.fromEntries(
      ['mmdb', 'geoip', 'asn', 'geosite'].map((key) => [key, `https://example.test/${key}`])
    )
  }
}))
vi.mock('./release-download', () => ({ fetchReleaseAsset: mocks.fetch }))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.exists.mockReturnValue(false)
  mocks.config.mockResolvedValue({})
  mocks.write.mockResolvedValue(undefined)
})
describe('explicit Geo resource download', () => {
  it('reports absent data without fetching or modifying files', async () => {
    const { getGeoResourceStatus } = await import('./geo-resources')
    expect(await getGeoResourceStatus()).toEqual([
      'country.mmdb',
      'geoip.dat',
      'ASN.mmdb',
      'geosite.dat'
    ])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('does not replace files when the source returns an error page', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } })
    )
    const { downloadGeoResources } = await import('./geo-resources')
    await expect(downloadGeoResources()).rejects.toThrow('不是有效数据库')
    expect(mocks.write).not.toHaveBeenCalled()
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
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('writes bounded downloads atomically to both work and validation directories', async () => {
    mocks.fetch.mockImplementation(async () => new Response(new Uint8Array(2048).fill(1)))
    const { downloadGeoResources } = await import('./geo-resources')
    await Promise.all([downloadGeoResources(), downloadGeoResources()])
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(mocks.write).toHaveBeenCalledTimes(8)
    expect(
      mocks.write.mock.calls.every(([file]) =>
        /country.mmdb|geoip.dat|ASN.mmdb|geosite.dat/.test(file)
      )
    ).toBe(true)
  })
})
